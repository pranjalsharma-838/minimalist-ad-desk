// Image library (user, 2026-10-05: "the user app library will also have images generated where they can search an image").
// One flat, searchable list of every image the project holds, each with a type label, product, notes and a usage line:
//   real pack photo (assets/raw + hires) · cut-out · verified ChatGPT pack render · verified texture shot ·
//   AI scenes / people / frames (pipeline/runs/*/backgrounds, "AI - Severe") · real texture · image-studio requests ·
//   real customer review photos (reference only).
// Read-only. imageFile() backs the /img/<path> route and serves ONLY image files under those folders.
import fs from "node:fs";
import path from "node:path";
import { root } from "./library.js";

const ASSETS = "brand_packs/minimalist/assets";
const IMG = /\.(png|jpe?g|webp)$/i;
const SCENE_DIR = /^pipeline\/runs\/[^/]+\/backgrounds$/;
// Folders the file route may serve from (relative to the project, forward slashes).
const ROOTS = [`${ASSETS}/raw`, `${ASSETS}/hires`, `${ASSETS}/cutouts`, `${ASSETS}/textures`, `${ASSETS}/ai_renders`, "image_requests", "research/review_photos"];

export const TYPES = {
  real_pack: { name: "Real pack photo", words: "real photo pack shot product bottle hires" },
  real_photo: { name: "Real photo", words: "real photo gallery listing" },
  cutout: { name: "Cut-out", words: "cutout cut-out transparent pack" },
  verified_render: { name: "Verified pack render", words: "verified render chatgpt ai pack master" },
  ai_texture: { name: "Texture shot (verified)", words: "texture swatch verified render chatgpt ai" },
  ai_scene: { name: "AI scene / person / frame", words: "ai scene person people frame background severe generated" },
  real_texture: { name: "Real texture", words: "real texture close-up macro swatch" },
  requested: { name: "Image studio request", words: "requested studio chatgpt prompt ai custom" },
  review_photo: { name: "Customer review photo", words: "customer review photo reference permission flipkart" },
};

const rel = (...p) => p.join("/");
const abs = (r) => path.join(root, ...r.split("/"));
const readJson = (r, d) => { try { return JSON.parse(fs.readFileSync(abs(r), "utf8")); } catch { return d; } };
const ls = (r) => { try { return fs.readdirSync(abs(r), { withFileTypes: true }); } catch { return []; } };
const url = (r) => `/img/${r.split("/").map(encodeURIComponent).join("/")}`;
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const pretty = (h) => String(h || "").replace(/-/g, " ");

// ---------- the file route: only image files inside the folders above ----------
export function imageFile(relPath) {
  let r;
  try { r = decodeURIComponent(String(relPath || "")); } catch { return null; }
  if (!r || r.includes("\0") || r.includes("\\") || r.startsWith("/") || /^[a-z]:/i.test(r) || !IMG.test(r)) return null;
  const parts = r.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  const dir = parts.slice(0, -1).join("/");
  const inside = ROOTS.some((d) => r.startsWith(d + "/")) || SCENE_DIR.test(dir);
  if (!inside) return null;
  try {
    const f = path.join(root, ...parts), real = fs.realpathSync(f);
    if (!real.startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(real).isFile()) return null;
    return f;
  } catch { return null; }
}

// ---------- the list ----------
function titles() {
  const idx = readJson(`${ASSETS}/index.json`, { assets: [] });
  const t = new Map();
  for (const a of idx.assets || []) if (a.product_handle && a.product_title) t.set(a.product_handle, a.product_title);
  return { idx, t };
}

function sceneKind(name) {
  if (/\.person\./.test(name)) return "AI person image";
  const f = name.match(/\.frame(\d+)\./);
  if (f) return `AI skin close-up, frame ${f[1]}`;
  if (/\.frames\./.test(name)) return "AI frame strip";
  return "AI scene";
}

function collect() {
  const { idx, t } = titles();
  const out = [];
  const add = (e) => out.push({ product: t.get(e.handle) || e.product || pretty(e.handle), notes: "", ai: false, ...e });

  // Real photos from the brand's own listings (raw), joined to the asset index for type and notes.
  const byFile = new Map((idx.assets || []).map((a) => [a.file, a]));
  for (const d of ls(`${ASSETS}/raw`).filter((x) => x.isDirectory())) {
    for (const f of ls(rel(ASSETS, "raw", d.name)).filter((x) => x.isFile() && IMG.test(x.name))) {
      const file = rel(ASSETS, "raw", d.name, f.name), a = byFile.get(file) || {};
      const pack = !a.type || a.type === "pack_shot";
      add({
        url: url(file), type: pack ? "real_pack" : "real_photo", handle: d.name, file: f.name,
        label: pack ? "Real pack photo" : `Real photo · ${String(a.type).replace(/_/g, " ")}`,
        notes: clip([a.notes, a.background && `background: ${a.background}`, a.source && `source: ${a.source}`].filter(Boolean).join(" · "), 400),
        usage: pack ? "Real photo from the brand's own listing. Can be used as the product image." : "Real photo from the brand's own listing. Check any text on it before reusing.",
      });
    }
  }
  for (const f of ls(`${ASSETS}/hires`).filter((x) => x.isFile() && IMG.test(x.name))) {
    const h = f.name.replace(/\.[^.]+$/, "");
    add({ url: url(rel(ASSETS, "hires", f.name)), type: "real_pack", handle: h, file: f.name, label: "Real pack photo (hi-res)", usage: "Real hi-res pack photo. This is the base the image studio re-renders from." });
  }
  // Cut-outs: <handle>_01.png (real photo) and <handle>_render.png (of the verified ChatGPT render).
  const cutByFile = new Map((idx.assets || []).filter((a) => a.cutout).map((a) => [a.cutout, a]));
  for (const f of ls(`${ASSETS}/cutouts`).filter((x) => x.isFile() && IMG.test(x.name))) {
    const m = f.name.match(/^(.+?)_(\d+|render)\.\w+$/);
    if (!m) continue;
    const file = rel(ASSETS, "cutouts", f.name), a = cutByFile.get(file) || {};
    add({
      url: url(file), type: "cutout", handle: m[1], file: f.name, ai: m[2] === "render",
      label: m[2] === "render" ? "Cut-out of the verified pack render" : "Cut-out of the real pack photo",
      notes: clip([a.cutout_status, m[2] === "render" && "cut from the label-verified ChatGPT render"].filter(Boolean).join(" · "), 300),
      usage: "Transparent pack cut-out: this is what the ads place on the canvas.",
    });
  }
  for (const f of ls(`${ASSETS}/textures`).filter((x) => x.isFile() && IMG.test(x.name))) {
    add({ url: url(rel(ASSETS, "textures", f.name)), type: "real_texture", handle: f.name.replace(/_[^_]*\.[^.]+$/, ""), file: f.name, label: "Real texture photo", usage: "Real, unretouched texture photo of the product. Used by the Texture format." });
  }
  // Verified ChatGPT renders and texture shots: only the file accepted in verification.json / texture_verification.json.
  for (const d of ls(`${ASSETS}/ai_renders`).filter((x) => x.isDirectory())) {
    const dir = rel(ASSETS, "ai_renders", d.name);
    const v = readJson(`${dir}/verification.json`, null);
    if (v?.accepted && fs.existsSync(abs(`${dir}/${v.accepted}`))) {
      const ok = /approved/i.test(v.status || "");
      add({
        url: url(`${dir}/${v.accepted}`), type: "verified_render", handle: d.name, file: v.accepted, ai: true,
        label: "Verified pack render (ChatGPT)", status: v.status || "",
        notes: clip(`${v.rounds ? `${v.rounds} round(s). ` : ""}${v.visual_read || ""}`, 500),
        usage: ok ? "AI re-render of the real pack, label checked word for word against the real pack. Can be used as the pack image." : "Not approved yet. Do not use.",
        use_in_ad: ok,
      });
    }
    const tv = readJson(`${dir}/texture_verification.json`, null);
    if (tv?.accepted && fs.existsSync(abs(`${dir}/${tv.accepted}`))) {
      add({
        url: url(`${dir}/${tv.accepted}`), type: "ai_texture", handle: d.name, file: tv.accepted, ai: true,
        label: "Texture shot (verified ChatGPT render)", status: tv.status || "",
        notes: clip([tv.visual_read, tv.swatch && `swatch: ${tv.swatch}`].filter(Boolean).join(" · "), 500),
        usage: "AI texture swatch next to the real pack, label verified. Not a real texture photo: do not present it as one.",
      });
    }
  }
  // AI scenes, people and frames made by the pipeline. Prompts come from the job files when they still exist.
  const prompts = new Map();
  for (const f of ls("pipeline/runs").filter((x) => x.isFile() && /^_jobs.*\.json$/.test(x.name))) {
    for (const j of readJson(`pipeline/runs/${f.name}`, [])) if (j?.id && j.prompt) prompts.set(j.id, j.prompt);
  }
  for (const run of ls("pipeline/runs").filter((x) => x.isDirectory())) {
    const dir = rel("pipeline/runs", run.name, "backgrounds");
    for (const f of ls(dir).filter((x) => x.isFile() && IMG.test(x.name))) {
      const base = f.name.replace(/\.[^.]+$/, "").split(".")[0];
      const h = (base.match(/^([a-z0-9-]+?)__/i) || [])[1] || "";
      add({
        url: url(`${dir}/${f.name}`), type: "ai_scene", handle: h, file: f.name, ai: true, product: h ? undefined : "No specific product", run: run.name,
        label: `AI — Severe · ${sceneKind(f.name)}`,
        notes: clip(`Run ${run.name}. ${prompts.get(base) || ""}`, 500),
        usage: "AI — Severe: any person, hands or skin is an AI model. Needs the AI mark and is not exportable as an ad.",
      });
    }
  }
  // Images made by the image studio from typed prompts.
  for (const f of ls("image_requests").filter((x) => x.isFile() && /^\d.*\.json$/.test(x.name) && !/\.(result|progress)\.json$/.test(x.name))) {
    const req = readJson(`image_requests/${f.name}`, null);
    if (!req?.id || !fs.existsSync(abs(`image_requests/${req.id}.png`))) continue;
    const res = readJson(`image_requests/${req.id}.result.json`, null);
    const status = res?.status || req.status;
    const done = status === "done";
    add({
      url: url(`image_requests/${req.id}.png`), type: "requested", handle: req.handle, product: req.product || undefined, file: `${req.id}.png`, ai: true, id: req.id, status,
      label: `Image studio · ${done ? "done" : status === "needs_review" ? "needs review" : status}`,
      notes: clip(`Prompt: ${req.prompt}${res?.notes ? ` · ${res.notes}` : ""}`, 600), prompt: req.prompt,
      check_url: fs.existsSync(abs(`image_requests/${req.id}_check.png`)) ? url(`image_requests/${req.id}_check.png`) : "",
      requested_at: req.requested_at,
      usage: done ? "Made by the image studio and label-checked against the real pack. Any person in it is an AI model: Severe, needs the AI mark." : status === "needs_review" ? "Needs review: the pack label did not pass the automatic check. Not offered for ads." : "Still being made or checked. Not offered for ads yet.",
    });
  }
  // Real customer review photos: reference only.
  for (const p of readJson("research/review_photos/index.json", [])) {
    if (!p.image_file || !IMG.test(p.image_file) || !fs.existsSync(abs(p.image_file))) continue;
    add({
      url: url(p.image_file), type: "review_photo", handle: p.handle, file: path.posix.basename(p.image_file),
      label: `Customer review photo · ${p.source || "marketplace"}`,
      notes: clip(`${p.stars ? `${p.stars} stars. ` : ""}${p.review_text ? `"${p.review_text}"` : ""}${p.reviewer ? ` — ${p.reviewer}` : ""}`, 400),
      usage: "Reference only. Needs the customer's permission before any use in an ad (copyright and the DPDP Act).",
    });
  }
  return out;
}

const ORDER = ["requested", "verified_render", "ai_texture", "cutout", "real_pack", "real_texture", "real_photo", "ai_scene", "review_photo"];

// q: every word must appear somewhere in the type, label, product, notes, prompt or file name. handle / type: exact filters.
export function listImages({ q = "", handle = "", type = "" } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  let list = collect();
  if (handle) list = list.filter((e) => e.handle === handle);
  if (type) list = list.filter((e) => e.type === type);
  if (words.length) {
    list = list.filter((e) => {
      const hay = [e.type.replace(/_/g, " "), TYPES[e.type].name, TYPES[e.type].words, e.label, e.handle, pretty(e.handle), e.product, e.notes, e.prompt, e.file, e.ai ? "ai generated" : "real", e.status, e.run].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  list.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || (a.type === "requested" ? String(b.requested_at).localeCompare(String(a.requested_at)) : String(a.handle).localeCompare(String(b.handle)) || a.file.localeCompare(b.file)));
  // words: the type's search words, so the app can search the whole list in the browser exactly as q does here.
  return list.map(({ url, type, handle, label, notes, ai, usage, ...rest }) => ({ url, type, handle, label, notes, ai, usage, words: TYPES[type].words, ...rest }));
}
