// Local server. No framework: node:http + static files + JSON API.
//   GET  /                     -> public/index.html
//   GET  /api/library?handle=  -> the product's existing library ads, grouped by format (read-only, instant)
//   GET  /api/library-all      -> every product's existing ads as one flat list (the "All ads" view; filtered in the browser)
//   GET  /library/<path>       -> a PNG / description file under ad_library/ (read-only)
//   POST /api/extract          {url, refresh?} | {manual:{...}} -> fact sheet (cached per product for 7 days) + live facts
//   GET  /api/image?src=       (Shopify CDN only)              -> image bytes (same-origin, so PNG export isn't blocked)
//   GET  /api/pack?handle=     -> the product visual from the asset library (verified render cut-out / cut-out / render)
//   GET  /api/texture?handle=  -> the product's real texture / close-up photo from the asset library
//   POST /api/generate         {sheet, mode?, format?, inputs?, variant?} -> copy + every format (ranked, rules-checked) + first one
//   POST /api/formats          {copy, sheet, inputs?}          -> every format again, rules-checked (after an edit)
//   POST /api/rescore          {copy, sheet, format, inputs?, rulesOnly?, variant?} -> one format, with the AI judge when a key is set
//   POST /api/draft            {copy, sheet, format, inputs?}  -> AI-written missing lines, cited and code-checked
//   POST /api/score            {ad, sheet?} | {image}          -> report
//   POST /api/image-request    {handle, prompt, sheet}         -> queues a request for the image studio (no image API)
//   GET  /api/image-requests?handle= -> that product's queued requests and any results
//   GET  /api/request-image?id= -> a finished request's image
//   GET  /api/images?q=&handle=&type= -> every image we hold (real, cut-out, verified renders, AI scenes, requests, review photos), searchable
//   GET  /img/<path>           -> one image file under the allowed image folders only (read-only, path-traversal safe)
//   GET  /api/status                                           -> which layers are active
//   POST /api/key              {key} | {clear:true}            -> sets the Claude API key for this session (memory only)
import http from "node:http";
import fs2 from "node:fs";
import path2 from "node:path";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFromUrl, factSheetFromManual, parseProductUrl } from "./lib/extract.js";
import { keyStore } from "./lib/request_key.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
// Online version (ONLINE=1, the hosted copy; 2026-10-27: "anyone with the link can open it"): each visitor's key comes with
// their own requests (x-claude-key header) and is never stored on the server; new images (OpenAI key / ChatGPT window
// queue) are off, since they need this computer.
const ONLINE = process.env.ONLINE === "1";
const ONLINE_NO_IMAGES = "The online version makes new images for a build only (with your OpenAI key); this image box needs the tool on your own computer.";
const keyFrom = (req) => { const k = String(req.headers["x-claude-key"] || "").trim(); return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k) ? k : ""; };
// The visitor's OpenAI key, the same way (2026-10-28: new images online with the visitor's own key).
const openaiFrom = (req) => { const k = String(req.headers["x-openai-key"] || "").trim(); return ONLINE && /^sk-[A-Za-z0-9_-]{20,}$/.test(k) ? k : ""; };
// The states of the visitor's image jobs (inputs.images), kept to plain short strings.
const imageStates = (m) => Object.fromEntries(Object.entries(m && typeof m === "object" ? m : {}).slice(0, 60).filter(([k]) => /^[\w-]{1,160}$/.test(k)).map(([k, v]) => [k, { status: String(v?.status || "").slice(0, 20), progress: String(v?.progress || "").slice(0, 200), notes: String(v?.notes || "").slice(0, 600) }]));
const IMAGE_HOSTS = new Set(["cdn.shopify.com", "beminimalist.co", "www.beminimalist.co"]);
// Images referenced by a product page this server has just read (any brand): the only other images /api/image will fetch.
const pageImages = new Set();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".md": "text/markdown; charset=utf-8" };

// Loaded lazily so the server still starts (extract + render) while those modules are being built.
async function lazy(mod) {
  return import(mod);
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
async function sendFile(res, file, maxAge = 3600) {
  // On Vercel the function holds empty stand-ins for images; the real file is a static file at the same path.
  if (process.env.VERCEL && /\.(png|jpe?g|webp)$/i.test(file)) {
    res.writeHead(302, { location: "/" + path.relative(here, file).split(path.sep).map(encodeURIComponent).join("/"), "cache-control": `max-age=${maxAge}` });
    return res.end();
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": `max-age=${maxAge}` });
  res.end(await fs.readFile(file));
}

async function readJson(req, limit = 12 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleApi(req, res, url) {
  const q = (k) => url.searchParams.get(k) || "";
  if (url.pathname === "/api/status") {
    const { judgeAvailable } = await lazy("./lib/judge.js");
    const { studioAvailable } = await lazy("./lib/library.js");
    return send(res, 200, { openai: ONLINE ? Boolean(keyStore.getStore()?.openai) : Boolean(process.env.OPENAI_API_KEY), studio: !ONLINE && studioAvailable(), llm: judgeAvailable(), online: ONLINE, rulesVersion: (await lazy("./lib/rules.js")).RULES.version });
  }
  if (req.method === "GET") {
    if (url.pathname === "/api/image") {
      const src = new URL(q("src"));
      const { checkPublicUrl } = await lazy("./lib/extract_generic.js");
      if (!IMAGE_HOSTS.has(src.hostname)) { try { checkPublicUrl(src.href); } catch (e) { return send(res, 400, { error: e.message }); } if (!pageImages.has(src.href)) return send(res, 400, { error: "Image host not allowed" }); }
      const r = await fetch(src, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!r.ok) return send(res, 502, { error: `Image fetch failed: HTTP ${r.status}` });
      res.writeHead(200, { "content-type": r.headers.get("content-type") || "image/png", "cache-control": "max-age=3600" });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    // The product visual from disk (no CDN fetch): the asset library's verified render cut-out, cut-out or render.
    if (url.pathname === "/api/pack") {
      const { packVisual } = await lazy("./lib/app_formats.js");
      const v = packVisual(q("handle"), null);
      if (!v?.file) return send(res, 404, { error: "No pack image on file for this product" });
      return sendFile(res, path.join(here, v.file), 600);
    }
    // A product's real texture / close-up photo from the asset library, for the Texture format.
    if (url.pathname === "/api/texture") {
      const { textureOf } = await lazy("./lib/app_formats.js");
      const t = textureOf({ url: `https://beminimalist.co/products/${q("handle")}` });
      if (!t) return send(res, 404, { error: "No texture photo for this product" });
      return sendFile(res, path.join(here, t.file));
    }
    if (url.pathname === "/api/library") {
      const { libraryFor } = await lazy("./lib/library.js");
      return send(res, 200, libraryFor(q("handle")));
    }
    if (url.pathname === "/api/library-all") {
      const { libraryAll } = await lazy("./lib/library.js");
      return send(res, 200, libraryAll());
    }
    if (url.pathname === "/api/image-requests") {
      const { imageRequests } = await lazy("./lib/library.js");
      return send(res, 200, { requests: imageRequests(q("handle")) });
    }
    if (url.pathname === "/api/images") {
      const { listImages } = await lazy("./lib/images.js");
      return send(res, 200, listImages({ q: q("q"), handle: q("handle"), type: q("type") }));
    }
    if (url.pathname === "/api/request-image") {
      const { requestImageFile } = await lazy("./lib/library.js");
      const f = requestImageFile(q("id"));
      if (!f) return send(res, 404, { error: "No image for that request yet" });
      return sendFile(res, f, 60);
    }
  }
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const body = await readJson(req);
  if (ONLINE) keyStore.getStore().images = imageStates(body.inputs?.images);
  // Claude API key typed into the app (2026-10-04: the people running it bring their own key). It lives only in this
  // server's memory: never written to disk, never logged, gone on restart. A key in .env still works and is kept.
  // Only accepted from this machine.
  if (url.pathname === "/api/key") {
    if (!ONLINE && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return send(res, 403, { error: "Keys can only be set from this computer." });
    if (body.clear) { if (!ONLINE) delete process.env.ANTHROPIC_API_KEY; return send(res, 200, { llm: false }); }
    const key = String(body.key || "").trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return send(res, 400, { error: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." });
    // Check it once against the API (lists models, no tokens used) so a wrong key fails here, not mid-generation.
    const r = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }).catch(() => null);
    if (!r) return send(res, 502, { error: "Couldn't reach the Anthropic API from this computer. Check the internet connection and try again." });
    if (r.status === 401 || r.status === 403) return send(res, 400, { error: "Anthropic rejected this key. Check it was copied in full." });
    // Online: checked only. The visitor's browser keeps it and sends it with each of their own requests.
    if (!ONLINE) process.env.ANTHROPIC_API_KEY = key;
    return send(res, 200, { llm: true });
  }

  // OpenAI key for images (memory only, localhost only). With a key the server itself makes queued image-studio requests through
  // the OpenAI Images API; without one the web-ChatGPT worker (npm run studio) stays the way.
  if (url.pathname === "/api/openai-key") {
    if (!ONLINE && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return send(res, 403, { error: "Keys can only be set from this computer." });
    if (body.clear) { if (!ONLINE) delete process.env.OPENAI_API_KEY; return send(res, 200, { images: false }); }
    const key = String(body.key || "").trim();
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) return send(res, 400, { error: "That doesn't look like an OpenAI API key (it starts with sk-)." });
    const { validateOpenAiKey } = await lazy("./lib/image_api.js");
    const v = await validateOpenAiKey(key);
    if (!v.ok) return send(res, 400, { error: v.error });
    // Online: checked only; the visitor's browser keeps it and sends it with each of their own requests.
    if (!ONLINE) process.env.OPENAI_API_KEY = key;
    return send(res, 200, { images: true });
  }
  // Online: one round of making a new image for a job the browser holds (lib/online_image.js).
  if (url.pathname === "/api/make-image") {
    if (!ONLINE) return send(res, 404, { error: "Unknown endpoint" });
    const { makeImageRound } = await lazy("./lib/online_image.js");
    return send(res, 200, await makeImageRound({ job: body.job, baseData: body.baseData, round: body.round }));
  }

  if (url.pathname === "/api/extract") {
    const { refusalReason } = await lazy("./lib/extract.js");
    const { addLiveFacts } = await lazy("./lib/live_facts.js");
    let sheet, cached = null;
    if (body.manual) sheet = factSheetFromManual(body.manual);
    else {
      // LIVE by default (user, 2026-10-05): the page is read now, every time, for any brand. A saved copy (beminimalist.co only,
      // up to 7 days old) is used only when "useSaved" is asked for.
      const { extractFromAnyUrl, brandSiteOf, NOT_MINIMALIST } = await lazy("./lib/extract_generic.js");
      const { cachedSheet, saveSheet } = await lazy("./lib/library.js");
      // A link pasted without "https://" (e.g. "beminimalist.co/products/…") or with spaces around it is accepted.
      body.url = String(body.url || "").trim();
      if (body.url && !/^https?:\/\//i.test(body.url)) body.url = `https://${body.url.replace(/^\/+/, "")}`;
      const isMin = brandSiteOf(body.url) === "minimalist";
      if (!isMin) throw new Error(NOT_MINIMALIST);
      const handle = isMin ? parseProductUrl(body.url).handle : "";
      const c = body.useSaved && isMin ? cachedSheet(handle) : null;
      if (c) { sheet = c.sheet; cached = c.fetched_at; } else { sheet = await extractFromAnyUrl(body.url); if (isMin) saveSheet(handle, sheet); }
      for (const i of sheet.images || []) if (/^https?:/.test(i)) pageImages.add(i);
    }
    sheet = addLiveFacts(sheet);
    return send(res, 200, { sheet, refusal: refusalReason(sheet), cached });
  }
  if (url.pathname === "/api/generate") {
    const { generateAd } = await lazy("./lib/generate.js");
    const out = await generateAd(body.sheet, { mode: body.mode, format: body.format, inputs: body.inputs, variant: body.variant });
    // Online: the new-image jobs this build queued, for the visitor's browser to make.
    return send(res, 200, ONLINE ? { ...out, jobs: keyStore.getStore().queued } : out);
  }
  if (url.pathname === "/api/formats") {
    const { allFormats } = await lazy("./lib/generate.js");
    return send(res, 200, await allFormats(body.copy, body.sheet, { ...(body.inputs || {}), fresh: true, variant: Number(body.variant) || 0 }));
  }
  if (url.pathname === "/api/rescore") {
    // One format: re-render spec, re-check layout, score (rules + AI judge when a key is set) against the same page.
    const { formatItem } = await lazy("./lib/generate.js");
    return send(res, 200, await formatItem(body.copy, body.sheet, body.format || "hero", { ...(body.inputs || {}), fresh: true, variant: Number(body.variant) || 0 }, { rulesOnly: Boolean(body.rulesOnly) }));
  }
  if (url.pathname === "/api/draft") {
    const { draftLines } = await lazy("./lib/app_draft.js");
    return send(res, 200, await draftLines(body.format, body.copy, body.sheet, body.inputs || {}));
  }
  if (url.pathname === "/api/image-request") {
    if (ONLINE) return send(res, 403, { error: ONLINE_NO_IMAGES });
    const { queueImageRequest } = await lazy("./lib/library.js");
    return send(res, 200, queueImageRequest(body.handle, body.prompt, body.sheet));
  }
  if (url.pathname === "/api/score") {
    const { scoreAd, scoreImageAd } = await lazy("./lib/score.js");
    const result = body.image ? await scoreImageAd(body.image, body.mediaType) : await scoreAd(body.ad, { sheet: body.sheet });
    return send(res, 200, result);
  }
  return send(res, 404, { error: "Unknown endpoint" });
}

// Also the Vercel function's handler (vercel/build.mjs), which runs it without the listener or the image timer below.
export const app = (req, res) => keyStore.run({ claude: keyFrom(req), openai: openaiFrom(req), queued: [] }, () => handle(req, res));
const server = http.createServer(app);
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    // Existing library ads, read-only, only under ad_library/.
    if (url.pathname.startsWith("/library/")) {
      const { libraryFile } = await lazy("./lib/library.js");
      const f = libraryFile(url.pathname.slice("/library/".length));
      return f ? sendFile(res, f) : send(res, 404, { error: "Not in the ad library" });
    }
    // Image library files, read-only, only the folders lib/images.js lists.
    if (url.pathname.startsWith("/img/")) {
      const { imageFile } = await lazy("./lib/images.js");
      const f = imageFile(url.pathname.slice("/img/".length));
      return f ? sendFile(res, f, 60) : send(res, 404, { error: "Not in the image library" });
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.normalize(path.join(here, "public", rel));
    if (!file.startsWith(path.join(here, "public"))) return send(res, 403, "Forbidden", "text/plain");
    const data = await fs.readFile(file);
    send(res, 200, data, TYPES[path.extname(file)] || "application/octet-stream");
  } catch (e) {
    const code = e.code === "ENOENT" ? 404 : 500;
    send(res, code, { error: e.message });
  }
}

// Image requests: made here through the OpenAI Images API whenever an OpenAI key is set (checked each time, so a key pasted later works).
let apiBusy = false;
if (!process.env.VERCEL) setInterval(async () => {
  if (!process.env.OPENAI_API_KEY) return;
  // heartbeat first, also while a batch is still running, so the ChatGPT worker keeps to its backup role
  try { const W0 = await import("./scripts/image_studio_worker.mjs"); fs2.mkdirSync(W0.queuePath(), { recursive: true }); fs2.writeFileSync(path2.join(W0.queuePath(), "api.heartbeat"), new Date().toISOString()); } catch { /* never stop */ }
  if (apiBusy) return;
  apiBusy = true;
  try {
    const W = await import("./scripts/image_studio_worker.mjs"), { createApiStudio } = await import("./lib/image_api.js");
    // Up to 4 images at once (user, 2026-10-05: "all shoot parallely"); the product render still comes first, because
    // the queue holds a build's other images until it has a result.
    // OpenAI is the main route: mark it live for the ChatGPT worker, make up to 4 images at once (each gets 2 attempts),
    // and hand any request that still fails to the ChatGPT window as the backup.
    await Promise.all(W.listQueued().slice(0, 4).map(async (r) => { if ((await W.handleRequest(r, createApiStudio())) === "failed") W.handToChatGPT(r); }));
  } catch (e) { console.log(`image requests: ${e.message.replace(/sk-[A-Za-z0-9_-]+/g, "[key]")}`); }
  apiBusy = false;
}, 5000).unref();

if (!process.env.VERCEL) server.listen(PORT, () => {
  console.log(`Minimalist ad tool running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No Claude API key yet: paste one in the app (top right), or put ANTHROPIC_API_KEY in .env. Until then, copy is word-for-word from the product page and the scorer runs its rules only.");
  }
});
