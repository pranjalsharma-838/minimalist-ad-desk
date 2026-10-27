// Image generation through the OpenAI Images API (layer 7), when OPENAI_API_KEY is in .env.
// Without a key the pipeline falls back to pasting prompts into ChatGPT in the browser.
// Every prompt is checked first (lib/image_prompt_check.js); the result is a BACKGROUND or scene only —
// the real pack shot and checked copy are composited afterwards by public/render.js.
// NOTE: written 2026-10-03 without a key to test against — first live call must be verified by eye.
import "./env.js";
import { checkImagePrompt } from "./image_prompt_check.js";

export const imageApiAvailable = () => Boolean(process.env.OPENAI_API_KEY);

export async function generateBackground(prompt, { size = "1024x1024", model = process.env.IMAGE_MODEL || "gpt-image-1" } = {}) {
  if (!imageApiAvailable()) throw new Error("No OPENAI_API_KEY in .env — use the browser image step instead.");
  const check = checkImagePrompt(prompt);
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, prompt, size, n: 1 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Image API ${res.status}: ${body?.error?.message || "unknown error"}`);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image API returned no image data.");
  return { png: Buffer.from(b64, "base64"), prompt_check: check, model };
}

// ---------- image studio engine: OpenAI Images edit API (works on any computer, no ChatGPT browser) ----------
// Same interface as the web-ChatGPT studio in scripts/image_studio_worker.mjs: ready() / generate() / correct().
// The base (real pack) image is attached; the worker's pack-identical suffix is already in the prompt it passes.
import fs from "node:fs";
import path from "node:path";
export const OPENAI_IMAGE_SIZE = "1024x1536";
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// The request, built but not sent (so it can be tested with no key).
export function buildEditRequest({ prompt, baseFile, key, model = process.env.IMAGE_MODEL || "gpt-image-1", size = OPENAI_IMAGE_SIZE }) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("n", "1");
  const bytes = fs.readFileSync(baseFile);
  form.append("image", new Blob([bytes], { type: MIME[path.extname(baseFile).toLowerCase()] || "image/png" }), path.basename(baseFile));
  return { url: "https://api.openai.com/v1/images/edits", init: { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form } };
}

export function createApiStudio({ getKey = () => process.env.OPENAI_API_KEY, fetchImpl = (...a) => fetch(...a) } = {}) {
  let last = null;
  const run = async (prompt, baseFile, outFile) => {
    const key = getKey();
    if (!key) throw new Error("No OpenAI key set.");
    // A scene with no pack in it (text-only request) goes to the plain generations endpoint.
    const { url, init } = baseFile ? buildEditRequest({ prompt, baseFile, key }) : { url: "https://api.openai.com/v1/images/generations", init: { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: process.env.IMAGE_MODEL || "gpt-image-1", prompt, size: OPENAI_IMAGE_SIZE, n: 1 }) } };
    const res = await fetchImpl(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI Images ${res.status}: ${body?.error?.message || "unknown error"}`);
    const b64 = body?.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI Images returned no image data.");
    fs.writeFileSync(outFile, Buffer.from(b64, "base64"));
  };
  return {
    async open() { return Boolean(getKey()); },
    async ready() { return Boolean(getKey()); },
    async generate({ prompt, baseFile, outFile }) { last = { prompt, baseFile }; await run(prompt, baseFile, outFile); },
    async correct({ text, outFile }) { await run(`${last.prompt} ${text}`, last.baseFile, outFile); },
    async close() {},
  };
}
// Checks a key without spending anything (lists models).
export async function validateOpenAiKey(key, fetchImpl = (...a) => fetch(...a)) {
  const r = await fetchImpl("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } }).catch(() => null);
  if (!r) return { ok: false, error: "Couldn't reach OpenAI from this computer." };
  if (r.status === 401 || r.status === 403) return { ok: false, error: "OpenAI rejected this key. Check it was copied in full." };
  return { ok: true };
}