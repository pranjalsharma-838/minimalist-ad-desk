// Library first (user, 2026-10-05): when a product is entered, its EXISTING ads (ad_library/<handle>/<format>/<id>.png +
// <id>.md, written by pipeline/09_library.js) are shown at once, grouped by format, before anything new is made.
// Read-only. Also: the product-page fact sheet cache and the image-studio request queue.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = path.join(root, "ad_library");

const cell = (md, label) => (md.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, "m")) || [])[1] || "";
const section = (md, title) => (md.split(new RegExp(`^## ${title}.*$`, "m"))[1] || "").split(/^## /m)[0].trim();

// Whether the compose step marked the ad exportable (pipeline/runs/<run>/finals/summary.json); without that file, the
// library's own rule: Severe or a model on the creative is never exportable.
const summaries = new Map();
function exportableOf(run, sourceId, risk, md) {
  if (!summaries.has(run)) {
    const f = path.join(root, "pipeline", "runs", run, "finals", "summary.json");
    try { summaries.set(run, new Map(JSON.parse(fs.readFileSync(f, "utf8")).map((s) => [s.id, s]))); } catch { summaries.set(run, null); }
  }
  const s = summaries.get(run)?.get(sourceId);
  if (s) return { exportable: Boolean(s.exportable), why: (s.layoutIssues || []).join("; ") || (s.recheck === "BLOCKED" ? "Re-check blocked." : "") };
  const no = risk === "severe" || /not exportable/i.test(md);
  return { exportable: !no, why: no ? "Severe risk: a model (AI person, hands or skin) is used." : "" };
}

// The scores written by scripts/score_library.js: <id>.scores.json beside the ad, else the ad_library/scores.json index.
// Returns null when the ad hasn't been scored (the app then says so instead of showing blanks).
let scoreIndex = { mtime: -1, data: {} };
function scoresOf(dir, id) {
  const pick = (r) => r && { alignment: r.alignment ?? null, alignment_band: r.alignment_band || "", win: r.win ?? null, win_band: r.win_band || "", compliance: r.compliance ?? null, verdict: r.verdict || "", verdict_label: r.verdict_label || "", findings: Array.isArray(r.findings) ? r.findings : [], reviewed_by: r.reviewed_by || "", parts: { alignment: r.parts?.alignment || [], win: r.parts?.win || [] } };
  try { return pick(JSON.parse(fs.readFileSync(path.join(dir, `${id}.scores.json`), "utf8"))); } catch { /* try the index */ }
  try {
    const f = path.join(LIB, "scores.json"), m = fs.statSync(f).mtimeMs;
    if (m !== scoreIndex.mtime) scoreIndex = { mtime: m, data: JSON.parse(fs.readFileSync(f, "utf8")) };
    return pick(scoreIndex.data[id]) || null;
  } catch { return null; }
}

export function libraryFor(handle) {
  const dir = path.join(LIB, handle);
  if (!/^[a-z0-9-]+$/i.test(handle) || !fs.existsSync(dir)) return { handle, groups: [], count: 0 };
  const groups = [];
  for (const fmt of fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const files = fs.readdirSync(path.join(dir, fmt));
    const ads = [];
    for (const mdName of files.filter((f) => f.endsWith(".md"))) {
      const id = mdName.slice(0, -3);
      if (!files.includes(`${id}.png`)) continue;
      const md = fs.readFileSync(path.join(dir, fmt, mdName), "utf8");
      const run = cell(md, "Run");
      const risk = (cell(md, "Risk level").match(/\*\*(\w+)\*\*/) || [])[1] || "";
      const format = cell(md, "Format");
      const ex = exportableOf(run, id.replace(/__[^_]+$/, ""), risk, md);
      const copyLines = section(md, "Copy on the creative").split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
      const title = (md.match(/^# .*? — (.*)$/m) || [])[1] || fmt;
      ads.push({
        // handle / product / fmt / fmt_title let the "All ads" view and its filters work on one flat list
        handle, product: cell(md, "Product").replace(/\s*\(https?:[^)]*\)\s*$/, "") || handle.replace(/-/g, " "), fmt, fmt_title: title.replace(/\s*\(variant \d+\)$/, ""),
        id, run, risk, ai: /^yes/i.test(cell(md, "AI imagery")),
        verdict: cell(md, "Compliance verdict"), template: format.replace(/\s*·.*$/, ""),
        title,
        on_image: copyLines, caption: section(md, "Caption"), exportable: ex.exportable, not_exportable_why: ex.why,
        scores: scoresOf(path.join(dir, fmt), id),
        png: `/library/${handle}/${fmt}/${id}.png`, md: `/library/${handle}/${fmt}/${id}.md`,
        placements: files.filter((f) => f.startsWith(`${id}.`) && /\.(4x5|9x16|[a-z]{2})\.png$/.test(f)).map((f) => ({ label: f.slice(id.length + 1, -4).replace("x", ":"), png: `/library/${handle}/${fmt}/${f}` })),
      });
    }
    if (ads.length) groups.push({ format: fmt, title: ads[0].title.replace(/\s*\(variant \d+\)$/, ""), template: ads[0].template, ads: ads.sort((a, b) => b.run.localeCompare(a.run)) });
  }
  groups.sort((a, b) => a.title.localeCompare(b.title));
  return { handle, groups, count: groups.reduce((n, g) => n + g.ads.length, 0) };
}

// Every product's ads in one flat list, for the "All ads" view (filtered and sorted in the browser).
export function libraryAll() {
  let handles = [];
  try { handles = fs.readdirSync(LIB, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* no library yet */ }
  const ads = [];
  for (const h of handles.sort()) for (const g of libraryFor(h).groups) ads.push(...g.ads);
  return { ads, count: ads.length };
}

// A file under ad_library/ (png or md only), for the read-only /library/ route.
export function libraryFile(rel) {
  const f = path.normalize(path.join(LIB, decodeURIComponent(rel)));
  if (!f.startsWith(LIB + path.sep) || !/\.(png|md)$/i.test(f) || !fs.existsSync(f)) return null;
  return f;
}

// ---------- product-page fact sheets, cached per handle (user, 2026-10-05: repeat runs skip the page fetch) ----------
const CACHE = path.join(root, "cache", "sheets");
const WEEK = 7 * 24 * 3600 * 1000;
export function cachedSheet(handle) {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(CACHE, `${handle}.json`), "utf8"));
    return Date.now() - Date.parse(c.fetched_at) < WEEK ? c : null;
  } catch { return null; }
}
export function saveSheet(handle, sheet) {
  if (!/^[a-z0-9-]+$/i.test(handle)) return;
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, `${handle}.json`), JSON.stringify({ fetched_at: new Date().toISOString(), sheet }, null, 1));
}

// ---------- image studio queue (user, 2026-10-05) ----------
// The app never calls an image API. "Make a different image" writes a request here; an operator script drives the
// user's own ChatGPT (label-verified, up to 3 rounds) and writes <id>.result.json beside it. See image_requests/README.md.
// STUDIO_QUEUE_DIR points the app and the worker at another queue folder (tests).
const queueDir = () => (process.env.STUDIO_QUEUE_DIR ? path.resolve(process.env.STUDIO_QUEUE_DIR) : path.join(root, "image_requests"));
// Can a new image be made right now? An OpenAI key (the server makes it) or a studio worker that wrote its heartbeat in the last 90 s.
export function studioAvailable() {
  if (process.env.OPENAI_API_KEY) return true;
  try { return Date.now() - fs.statSync(path.join(queueDir(), "worker.heartbeat")).mtimeMs < 90000; } catch { return false; }
}
// One request by id: { id, status, progress, notes, url } (url only once a finished image exists).
export function requestState(id) {
  if (!/^[\w-]+$/.test(String(id || ""))) return null;
  const dir = queueDir();
  let req = null, result = null;
  try { req = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")); } catch { return null; }
  try { result = JSON.parse(fs.readFileSync(path.join(dir, `${id}.result.json`), "utf8")); } catch { /* not done yet */ }
  const status = result?.status || req.status;
  const url = result?.image && ["done", "needs_review"].includes(status) && requestImageFile(id) ? `/api/request-image?id=${encodeURIComponent(id)}` : "";
  return { id, status, progress: req.progress || "", notes: result?.notes || "", url };
}
function baseImage(handle, sheet) {
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(root, "brand_packs/minimalist/assets/ai_renders", handle, "verification.json"), "utf8"));
    const f = `brand_packs/minimalist/assets/ai_renders/${handle}/${ver.accepted}`;
    if (ver.accepted && fs.existsSync(path.join(root, f))) return f;
  } catch { /* none */ }
  for (const ext of ["jpg", "png", "webp"]) { const f = `brand_packs/minimalist/assets/hires/${handle}.${ext}`; if (fs.existsSync(path.join(root, f))) return f; }
  return sheet?.images?.[0] || "";
}
export function queueImageRequest(handle, prompt, sheet, opts = {}) {
  // Online version (ONLINE=1): no image studio or OpenAI key runs there, so nothing is queued that could never be made.
  if (process.env.ONLINE === "1") throw new Error("New images aren't made in the online version.");
  if (!/^[a-z0-9-]+$/i.test(handle)) throw new Error("Image requests need a beminimalist.co product.");
  const text = String(prompt || "").trim();
  if (text.length < 8) throw new Error("Describe the image you want (a sentence or two).");
  const QUEUE = queueDir();
  fs.mkdirSync(QUEUE, { recursive: true });
  // opts.format: the app format this image is for (one request per format per build); opts.textOnly: a scene with no pack in it (no base image, no label check).
  const id = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z")}${opts.format ? `_${opts.format}` : ""}_${handle}`;
  const req = { id, handle, product: sheet?.title || "", prompt: text.slice(0, 2000), base_image: opts.textOnly ? "" : baseImage(handle, sheet), ...(opts.textOnly ? { text_only: true } : {}), ...(opts.format ? { format: opts.format } : {}), ...(opts.after ? { after: opts.after } : {}), requested_at: new Date().toISOString(), status: "queued" };
  fs.writeFileSync(path.join(QUEUE, `${id}.json`), JSON.stringify(req, null, 2));
  return req;
}
export function imageRequests(handle) {
  const QUEUE = queueDir();
  if (!fs.existsSync(QUEUE)) return [];
  return fs.readdirSync(QUEUE).filter((f) => f.endsWith(`_${handle}.json`) && !f.endsWith(".result.json")).sort().reverse().map((f) => {
    const req = JSON.parse(fs.readFileSync(path.join(QUEUE, f), "utf8"));
    let result = null;
    try { result = JSON.parse(fs.readFileSync(path.join(QUEUE, f.replace(/\.json$/, ".result.json")), "utf8")); } catch { /* not done yet */ }
    const img = result?.image && requestImageFile(req.id) ? `/api/request-image?id=${encodeURIComponent(req.id)}` : "";
    return { ...req, status: result?.status || req.status, result: result ? { ...result, url: img } : null };
  });
}
// The newest product render made in the app for this handle that passed its label check (the same ChatGPT loop as the
// library: re-render from the real pack photo, compare the label, up to 3 rounds). Later builds reuse it straight away.
export function passedRender(handle) {
  const QUEUE = queueDir();
  if (!fs.existsSync(QUEUE) || !/^[a-z0-9-]+$/i.test(handle)) return null;
  for (const f of fs.readdirSync(QUEUE).filter((f) => f.endsWith(`_render_${handle}.result.json`)).sort().reverse()) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(QUEUE, f), "utf8"));
      const id = f.replace(/\.result\.json$/, "");
      if (r.status === "done" && requestImageFile(id)) return id;
    } catch { /* skip */ }
  }
  return null;
}
// The result image of a request: only an image file inside the project folder.
export function requestImageFile(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  const QUEUE = queueDir();
  try {
    const r = JSON.parse(fs.readFileSync(path.join(QUEUE, `${id}.result.json`), "utf8"));
    let f = path.normalize(path.isAbsolute(r.image) ? r.image : path.join(root, r.image));
    if (!fs.existsSync(f) && !path.isAbsolute(r.image)) f = path.normalize(path.join(QUEUE, r.image)); // relative to the queue
    return (f.startsWith(root + path.sep) || f.startsWith(QUEUE + path.sep)) && /\.(png|jpe?g|webp)$/i.test(f) && fs.existsSync(f) ? f : null;
  } catch { return null; }
}

