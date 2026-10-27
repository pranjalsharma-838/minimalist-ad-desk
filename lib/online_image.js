// New images in the online version (2026-10-28: "make gpt images work online"), with the visitor's own keys.
// The laptop's image studio keeps a queue on disk and a background worker; the online server can do neither, so the
// visitor's browser drives it: one call here = one round of the same loop (draw with OpenAI from the real pack photo, then
// check the pack label against the real pack), and the browser asks for up to 3 rounds. The label check is Claude reading
// both images (the laptop uses scripts/verify_pack.py, which needs Python); without a Claude key the image is marked
// "not checked" and goes to review, like a failed check. Nothing is stored: the image goes back to the browser.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiStudio } from "./image_api.js";
import { structuredCall, loadPrompt, llmAvailable } from "./llm.js";
import { openaiKey } from "./request_key.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Same wording as scripts/image_studio_worker.mjs (SUFFIX, CORRECTION, fullPrompt), so both routes ask for the same image.
const SUFFIX = "Use the attached photo as the exact product: the pack must stay identical (shape, cap, colours, label layout and every word exactly as printed). Do not add, remove or change any text or logo on the pack.";
const CORRECTION = `The pack changed — keep the pack exactly as in the photo: ${SUFFIX}`;
function fullPrompt(prompt, textOnly) {
  let p = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!/^(create|generate|make|draw|render|edit|show|produce|design)\b/i.test(p)) p = `Create an image: ${p}`;
  return textOnly ? p : `${p} ${SUFFIX}`;
}

const IMAGE_HOSTS = new Set(["cdn.shopify.com", "beminimalist.co", "www.beminimalist.co"]);
const ASSET = /^brand_packs\/minimalist\/assets\/[\w./-]+\.(png|jpe?g|webp)$/i;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

// An image file of the project. On Vercel the function holds empty stand-ins, so the real file comes from the site's own
// static copy (the production address, never one taken from the request).
async function assetBytes(rel) {
  if (!ASSET.test(rel) || rel.split("/").includes("..")) throw new Error("That base image isn't allowed.");
  if (process.env.VERCEL) {
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const r = await fetch(`https://${host}/${rel.split("/").map(encodeURIComponent).join("/")}`);
    if (!r.ok) throw new Error(`Couldn't load the product photo (HTTP ${r.status}).`);
    return Buffer.from(await r.arrayBuffer());
  }
  return fs.readFileSync(path.join(root, rel));
}
async function urlBytes(u) {
  const url = new URL(u);
  if (!IMAGE_HOSTS.has(url.hostname)) throw new Error("That base image host isn't allowed.");
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`Couldn't download the product photo (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}
const typeOf = (buf) => (buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : buf.slice(8, 12).toString() === "WEBP" ? "image/webp" : "image/png");
function fromDataUrl(d) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(d || ""));
  if (!m) throw new Error("The product render sent back isn't an image.");
  return Buffer.from(m[2], "base64");
}

// The pack the result is compared with: the cut-out of the verified render if there is one (as the laptop does), else the base.
async function referenceFor(handle, base) {
  const cut = `brand_packs/minimalist/assets/cutouts/${handle}_render.png`;
  return fs.existsSync(path.join(root, cut)) ? assetBytes(cut).catch(() => base) : base;
}

const CHECK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "same_product", "label_text_matches", "differences"],
  properties: { verdict: { type: "string", enum: ["PASS", "REVIEW"] }, same_product: { type: "boolean" }, label_text_matches: { type: "boolean" }, differences: { type: "string" } },
};
async function checkPack(ref, img) {
  if (!llmAvailable()) return { verdict_hint: "REVIEW: label not checked (add a Claude key to check it)", checked: false };
  const { data } = await structuredCall({
    system: loadPrompt("pack_check_system.md"),
    user: [
      { type: "text", text: "REFERENCE (the real pack):" },
      { type: "image", source: { type: "base64", media_type: typeOf(ref), data: ref.toString("base64") } },
      { type: "text", text: "CANDIDATE (the new AI image):" },
      { type: "image", source: { type: "base64", media_type: typeOf(img), data: img.toString("base64") } },
    ],
    schema: CHECK_SCHEMA, effort: "low", maxTokens: 2000,
  });
  const pass = data.verdict === "PASS" && data.same_product && data.label_text_matches;
  return { verdict_hint: pass ? "PASS (Claude read the label against the real pack)" : `REVIEW: ${data.differences || "the pack doesn't match the real one"}`, checked: true };
}

// One round. job: { id, handle, prompt, base_image, text_only } as queued by lib/library.js queueImageRequest; baseData: the
// passed product render (data URL) for a job that waited for it; round: 1-3 (2 and 3 add the correction).
export async function makeImageRound({ job, baseData = "", round = 1 }) {
  if (!openaiKey()) throw new Error("Add your OpenAI key (Settings) to make new images.");
  if (!/^[\w-]{1,160}$/.test(String(job?.id || "")) || !/^[a-z0-9-]+$/i.test(String(job?.handle || ""))) throw new Error("Not a valid image job.");
  const prompt = String(job.prompt || "").trim();
  if (prompt.length < 8 || prompt.length > 2100) throw new Error("Not a valid image prompt.");
  const textOnly = Boolean(job.text_only);
  const n = Math.min(3, Math.max(1, Math.floor(Number(round) || 1)));
  let base = null;
  if (!textOnly) base = baseData ? fromDataUrl(baseData) : /^https?:/i.test(job.base_image || "") ? await urlBytes(job.base_image) : await assetBytes(String(job.base_image || ""));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
  try {
    let baseFile = "";
    if (base) { baseFile = path.join(dir, `base.${typeOf(base).split("/")[1]}`); fs.writeFileSync(baseFile, base); }
    const outFile = path.join(dir, "out.jpg");
    const studio = createApiStudio({ getKey: openaiKey, outputFormat: "jpeg" });
    await studio.generate({ prompt: `${fullPrompt(prompt, textOnly)}${n > 1 ? ` ${CORRECTION}` : ""}`, baseFile, outFile });
    const img = fs.readFileSync(outFile);
    const check = textOnly ? { verdict_hint: "PASS (scene only: no pack in the image, nothing to label-check)", checked: true } : await checkPack(await referenceFor(job.handle, base), img);
    return { image: `data:${typeOf(img)};base64,${img.toString("base64")}`, pass: /^PASS/.test(check.verdict_hint), checked: check.checked, verdict: check.verdict_hint, round: n };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
