import { renderAdSvg, SIZE, PLACEMENTS } from "./render.js";
import {
  VERDICTS, RISKS, SIZES, IMG_TYPES, IMG_GROUPS, IMG_SORTS,
  adDefaults, cleanAdState, filterAds, sortAds, adSortsFor, defaultAdSort, adFacetCounts, adOptions, activeAdFilters, countText,
  imgDefaults, cleanImgState, filterImages, sortImages, imgFacetCounts, imgProductOptions, activeImgFilters, usableInAds,
  parseHash, buildHash,
} from "./filters.js";
import { TEMPLATE_CSV, VERDICT_KEYS, parseCsv, parseXlsx, adsFromTable, summarise, sortRows, filterRows, resultsToCsv, statusText, runPool } from "./bulk.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The visitor's Claude key (online version, 2026-10-27): kept in this browser tab only and sent with each of this visitor's
// requests; the server uses it for that request and never stores it.
let claudeKey = "";
try { claudeKey = sessionStorage.getItem("claudeKey") || ""; } catch { /* storage blocked: the key lasts until the page reloads */ }
async function api(path, body) {
  const headers = { ...(body ? { "content-type": "application/json" } : {}), ...(claudeKey ? { "x-claude-key": claudeKey } : {}) };
  const r = await fetch(path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- status + Claude API key ----------
// Without a key the app still works (copy word for word from the page, rules-only check). With one, the writer and
// the AI judge run live. Locally the server keeps it in memory for the session; online it stays in this browser tab.
let llm = false, online = false;
function showStatus(s) {
  llm = s.llm;
  online = Boolean(s.online);
  $("#status").innerHTML = `Rules v${esc(s.rulesVersion)} · AI judge: <b class="${s.llm ? "on" : "off"}">${s.llm ? "on" : "off (rules only)"}</b> · Images: <b class="${s.openai ? "on" : "off"}">${s.online ? "not in the online version" : s.openai ? "OpenAI" : "ChatGPT window"}</b>`;
  $("#mode").querySelector('[value="model"]').disabled = !s.llm;
  if (!s.llm) $("#mode").value = "verbatim";
  $("#keyform").style.display = s.llm ? "none" : "";
  $("#oaform").style.display = s.openai || s.online ? "none" : "";
  updateBulkControls(); // image rows that were waiting for the key can be scored now
}
api("/api/status").then(showStatus).catch(() => ($("#status").textContent = "server not reachable"));
$("#keyform").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#keymsg").textContent = "checking…";
  try {
    const key = $("#apikey").value.trim();
    await api("/api/key", { key });
    claudeKey = key;
    try { sessionStorage.setItem("claudeKey", key); } catch { /* kept in memory only */ }
    $("#apikey").value = "";
    $("#keymsg").textContent = "";
    showStatus(await api("/api/status"));
    $("#mode").value = "model";
  } catch (err) {
    $("#keymsg").textContent = err.message;
  }
});

$("#oaform").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#oamsg").textContent = "checking…";
  try {
    await api("/api/openai-key", { key: $("#oakey").value });
    $("#oakey").value = "";
    $("#oamsg").textContent = "";
    showStatus(await api("/api/status"));
  } catch (err) { $("#oamsg").textContent = err.message; }
});

// ---------- tabs ----------
let currentTab = "generate";
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    currentTab = b.dataset.tab;
    document.querySelectorAll(".tab").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("hidden", p.id !== `tab-${b.dataset.tab}`));
    if (b.dataset.tab === "images") initImageLibrary();
    // "Final ads" (user, 2026-10-05): every finished library ad, all products, ads only. The same saved-ads browser,
    // moved into its own tab and opened on "All ads"; it moves back under the product when that tab is shown.
    const lib = $("#library"), home = $("#tab-generate");
    if (b.dataset.tab === "final") {
      $("#tab-final").appendChild(lib);
      $("#lib-details").open = true;
      openLibrary("all", { state: adDefaults() });
    } else if (b.dataset.tab === "generate" && lib.parentElement !== home) {
      home.appendChild(lib);
      if (!libHandle) { lib.classList.add("hidden"); libVisible = false; } else openLibrary("p", { h: libHandle, state: adDefaults() });
    }
    syncHash();
  })
);
const showTab = (name) => document.querySelector(`.tab[data-tab="${name}"]`).click();

// The address bar remembers the tab and every filter, so a filtered view can be shared and reopened (filters.js: parseHash / buildHash).
function syncHash() {
  const h = buildHash({ tab: currentTab, lib: libVisible ? libMode : "", h: libHandle, ads: adState, images: imgState });
  try { history.replaceState(null, "", location.pathname + location.search + h); } catch { /* a sandboxed page: skip */ }
}

// ---------- report rendering (shared) ----------
const SEV_LABEL = { block: "Block", fix: "Must fix", advisory: "Advisory" };
const DIM_LABEL = { policy: "Policy & claims", tone: "Brand tone", language: "Brand language" };
const FIELD_LABEL = { headline: "Headline", primary_text: "Primary text", on_image_text: "On-image text", footnote: "Footnote", cta: "CTA" };
const VERDICT_SHORT = { BLOCKED: "Blocked", NEEDS_CHANGES: "Fix first", READY_FOR_REVIEW: "Ready for review", LIMITED_CHECK: "Rules only" };

function highlightField(ad, field, findings) {
  const text = ad[field] || "";
  const marks = findings.filter((f) => f.field === field && f.end > f.start).sort((a, b) => a.start - b.start);
  let out = "", i = 0;
  for (const m of marks) {
    if (m.start < i) continue;
    out += esc(text.slice(i, m.start)) + `<mark class="${m.severity}" title="${esc(m.rule_id)}">${esc(text.slice(m.start, m.end))}</mark>`;
    i = m.end;
  }
  return out + esc(text.slice(i));
}

// Three scores (report.scores: brand alignment, chance to win, compliance), when the scorer provides them.
const pct = (n) => (typeof n === "number" ? Math.round(n <= 1 && n > 0 ? n * 100 : n) : "–");
function scoresCompact(sc) {
  if (!sc) return "";
  const a = sc.alignment, w = sc.win, c = sc.compliance;
  return `<span class="scores">${a ? `<span title="Brand alignment${a.band ? ": " + esc(a.band) : ""}">Fit ${pct(a.score)}</span>` : ""}${w ? `<span title="Chance to win${w.band ? ": " + esc(w.band) : ""}">Win ${pct(w.score)}</span>` : ""}${c ? `<span class="cmp ${esc(c.code)}" title="Compliance">${esc(c.label || c.code)}</span>` : ""}</span>`;
}
function scoresBlock(sc) {
  if (!sc) return "";
  const parts = (p) => (p || []).map((x) => `<li><b>${esc(x.name)}</b> ${pct(x.score)}${x.why ? ` <span class="hint">— ${esc(x.why)}</span>` : ""}</li>`).join("");
  const card = (title, s, extra = "") => s ? `<div class="score-card"><div class="score-top"><span>${title}</span><b>${pct(s.score)}</b>${s.band ? `<small>${esc(s.band)}</small>` : ""}</div>${extra}${s.parts?.length ? `<ul>${parts(s.parts)}</ul>` : ""}</div>` : "";
  const c = sc.compliance;
  return `<div class="score-cards">
    ${card("Brand alignment", sc.alignment)}
    ${card("Chance to win", sc.win, sc.win?.basis || sc.win?.n != null ? `<p class="hint">${sc.win.n != null ? `Based on ${esc(sc.win.n)} comparable ads. ` : ""}${esc(sc.win.basis || "")}</p>` : "")}
    ${c ? `<div class="score-card cmp ${esc(c.code)}"><div class="score-top"><span>Compliance</span><b>${c.score != null ? pct(c.score) : ""}</b><small>${esc(c.label || c.code)}</small></div></div>` : ""}
  </div>`;
}

export function renderReport(report, el) {
  const v = report.verdict;
  const dims = Object.entries(report.dimensions)
    .map(([d, s]) => `<div class="dim ${s.worst}"><span>${DIM_LABEL[d]}</span><b>${s.worst === "clear" ? "No issues found" : SEV_LABEL[s.worst]}</b><small>${s.count} finding${s.count === 1 ? "" : "s"}</small></div>`)
    .join("");
  const cov = report.coverage;
  const coverage = cov.model
    ? `Checked by: rule layer (rules v${esc(cov.rules_version)}) + model judgment (${esc(cov.model_name)}).`
    : `Checked by: rule layer only (rules v${esc(cov.rules_version)}). ${cov.model_error ? "Model call failed: " + esc(cov.model_error) : "No API key set"} — implied claims and overall tone were not assessed.`;
  const adView = Object.keys(FIELD_LABEL)
    .filter((f) => (report.ad[f] || "").trim())
    .map((f) => `<div class="adfield"><small>${FIELD_LABEL[f]}</small><div>${highlightField(report.ad, f, report.findings).replace(/\n/g, "<br>")}</div></div>`)
    .join("");
  const cards = report.findings
    .map(
      (f) => `<article class="finding ${f.severity}">
        <header><span class="sev">${SEV_LABEL[f.severity]}</span><span class="rid">${esc(f.rule_id)}</span> ${esc(f.title)} <span class="dimtag">${DIM_LABEL[f.dimension] || ""}</span></header>
        ${f.span ? `<blockquote>“${esc(f.span)}” <small>in ${FIELD_LABEL[f.field] || f.field}</small></blockquote>` : ""}
        <p>${esc(f.message)}</p>
        <p class="fixline"><b>Fix:</b> ${esc(f.fix)}</p>
        ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}
        ${f.model_comment ? `<p class="note">${esc(f.model_comment)}</p>` : ""}
        <footer>Source: ${(f.sources || []).map(esc).join(", ") || "—"} · basis: ${esc(f.confidence)} · found by ${f.layer === "model" ? "model" : "rule"}</footer>
      </article>`
    )
    .join("");
  const reads = report.tone_read
    ? `<div class="reads"><p><b>Tone:</b> ${esc(report.tone_read)}</p><p><b>Language:</b> ${esc(report.language_read)}</p></div>`
    : "";
  const dropped = report.dropped_model_findings?.length
    ? `<p class="hint">${report.dropped_model_findings.length} model finding(s) discarded because the quoted text wasn't in the ad or the rule id didn't exist.</p>`
    : "";
  el.innerHTML = `
    <div class="verdict ${v.code}"><b>${esc(v.label)}</b><span>${esc(v.detail)}</span></div>
    ${scoresBlock(report.scores)}
    <div class="dims">${dims}</div>
    <p class="coverage">${coverage}</p>
    ${reads}
    <h3>The ad, with flagged spans</h3><div class="adview">${adView}</div>
    <h3>${report.findings.length ? "Findings" : "No findings"}</h3>${cards}${dropped}`;
}

// ---------- images (pack shots, cut-outs, texture photos), inlined so PNG export works ----------
const imgCache = new Map();
function dataUrlOf(src) {
  if (!src) return Promise.resolve("");
  if (src.startsWith("data:")) return Promise.resolve(src);
  if (!imgCache.has(src)) {
    imgCache.set(src, (async () => {
      const r = await fetch(/^https?:/.test(src) ? "/api/image?src=" + encodeURIComponent(src) : src);
      if (!r.ok) return "";
      const b = await r.blob();
      return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
    })().catch(() => ""));
  }
  return imgCache.get(src);
}
// A photo with its own studio backdrop sets the canvas to that colour (its corner pixel), so it doesn't sit in a grey box.
const cornerCache = new Map();
function cornerColour(dataUrl) {
  if (!cornerCache.has(dataUrl)) cornerCache.set(dataUrl, (async () => {
    try {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const [r, g, b, a] = x.getImageData(2, 2, 1, 1).data;
      return a > 200 ? `rgb(${r},${g},${b})` : "";
    } catch { return ""; }
  })());
  return cornerCache.get(dataUrl);
}

// Studio product photos on a plain light backdrop (no verified render yet): each colour channel is scaled so the
// backdrop becomes pure white, then the last few shades are lifted to 255. The pack keeps its own shading and soft
// shadow, nothing is cut (a white tube on light grey cuts raggedly), and the photo sits on the white canvas like
// every other ad (user, 2026-10-05: "different background, this is not acceptable").
const whiteCache = new Map();
function autoWhite(dataUrl) {
  if (!whiteCache.has(dataUrl)) whiteCache.set(dataUrl, (async () => {
    try {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, W, H), p = d.data;
      const border = []; for (let i = 0; i < W; i += 4) border.push(i, (H - 1) * W + i); for (let j = 0; j < H; j += 4) border.push(j * W, j * W + W - 1);
      // the brightest 60% of border pixels describe the backdrop (the floor shadow is darker)
      const lum = border.map((i) => [p[i * 4] + p[i * 4 + 1] + p[i * 4 + 2], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.ceil(border.length * 0.6));
      const mean = [0, 1, 2].map((k) => lum.reduce((s, [, i]) => s + p[i * 4 + k], 0) / lum.length);
      const sat = Math.max(...mean) - Math.min(...mean);
      if (Math.min(...mean) >= 254.5 || Math.min(...mean) < 150 || sat > 24) return ""; // pure white already, too dark, or a coloured scene
      const gain = mean.map((m) => 255 / m);
      for (let q = 0; q < p.length; q += 4) for (let k = 0; k < 3; k++) { let v = p[q + k] * gain[k]; if (v > 238) v = 238 + (v - 238) * 3; p[q + k] = v > 255 ? 255 : v; }
      x.putImageData(d, 0, 0);
      return c.toDataURL("image/png");
    } catch { return ""; }
  })());
  return whiteCache.get(dataUrl);
}

// Background removal for studio product photos: flood-fills from the image border through pixels close to the
// backdrop colour (it tolerates the soft gradient of a studio sweep), makes them transparent and feathers the edge.
// Returns "" when the border is not a plain backdrop (a scene, a white photo already, or a busy background).
const cutCache = new Map();
function autoCut(dataUrl) {
  if (!cutCache.has(dataUrl)) cutCache.set(dataUrl, (async () => {
    try {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, W, H), p = d.data, at = (i) => [p[i * 4], p[i * 4 + 1], p[i * 4 + 2]];
      const border = []; for (let i = 0; i < W; i += 4) border.push(i, (H - 1) * W + i); for (let j = 0; j < H; j += 4) border.push(j * W, j * W + W - 1);
      const cols = border.map(at), mean = [0, 1, 2].map((k) => cols.reduce((s, v) => s + v[k], 0) / cols.length);
      const spread = Math.sqrt(cols.reduce((s, v) => s + (v[0] - mean[0]) ** 2 + (v[1] - mean[1]) ** 2 + (v[2] - mean[2]) ** 2, 0) / cols.length);
      if (spread > 40 || Math.min(...mean) > 248) return ""; // busy scene, or already on white
      const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      const seen = new Uint8Array(W * H), stack = [];
      for (const i of border) { seen[i] = 1; stack.push(i); }
      while (stack.length) {
        const i = stack.pop(), v = at(i); p[i * 4 + 3] = 0;
        const yy = (i / W) | 0, xx = i % W;
        for (const n of [xx > 0 ? i - 1 : -1, xx < W - 1 ? i + 1 : -1, yy > 0 ? i - W : -1, yy < H - 1 ? i + W : -1]) {
          if (n < 0 || seen[n]) continue;
          const u = at(n);
          if (dist(u, v) <= 18 && dist(u, mean) <= 90) { seen[n] = 1; stack.push(n); }
        }
      }
      // feather: a half-transparent rim on product pixels that touch the removed backdrop
      for (let i = 0; i < W * H; i++) if (p[i * 4 + 3] && ((i % W && !p[(i - 1) * 4 + 3]) || (i % W < W - 1 && !p[(i + 1) * 4 + 3]) || (i >= W && !p[(i - W) * 4 + 3]) || (i < W * H - W && !p[(i + W) * 4 + 3]))) p[i * 4 + 3] = 140;
      const A = (xx, yy) => p[(yy * W + xx) * 4 + 3] > 200;
      // bounding box of the product
      let x0 = W, x1 = -1, y0 = H, y1 = -1;
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (A(xx, yy)) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      if (x1 < 0) return "";
      // the photo's own cast shadow: the pack's width is measured on its body (40-65% down); anything opaque outside
      // that span in the bottom 30% is the old shadow, not the pack (same rule as scripts/trim_cutout_shadows.py)
      const ls = [], rs = [];
      for (let yy = Math.round(y0 + (y1 - y0) * 0.4); yy < y0 + (y1 - y0) * 0.65; yy++) { let a = -1, b = -1; for (let xx = x0; xx <= x1; xx++) if (A(xx, yy)) { if (a < 0) a = xx; b = xx; } if (a >= 0) { ls.push(a); rs.push(b); } }
      const med = (v) => v.sort((m, n) => m - n)[v.length >> 1];
      const bgLum = mean[0] + mean[1] + mean[2]; // a shadow is darker than the backdrop; the pack's own edge pixels are not removed
      if (ls.length) { const L = med(ls) - 4, R = med(rs) + 4; for (let yy = Math.round(y0 + (y1 - y0) * 0.7); yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { const q = (yy * W + xx) * 4; if ((xx < L || xx > R) && p[q] + p[q + 1] + p[q + 2] < bgLum - 24) p[q + 3] = 0; } }
      x.putImageData(d, 0, 0);
      // re-measure after the trim and crop tight, so the drop shadow the layout adds sits right under the pack
      // rows / columns count only when 1% of them is product, so a stray speck can't stretch the crop
      const rowN = new Array(H).fill(0), colN = new Array(W).fill(0);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) if (p[(yy * W + xx) * 4 + 3] > 20) { rowN[yy]++; colN[xx]++; }
      const rOk = (yy) => rowN[yy] > W * 0.01, cOk = (xx) => colN[xx] > H * 0.01;
      y0 = rowN.findIndex((_, i) => rOk(i)); y1 = H - 1 - [...rowN].reverse().findIndex((_, i) => rOk(H - 1 - i));
      x0 = colN.findIndex((_, i) => cOk(i)); x1 = W - 1 - [...colN].reverse().findIndex((_, i) => cOk(W - 1 - i));
      if (y0 < 0 || x0 < 0) return "";
      const kept = ((x1 - x0 + 1) * (y1 - y0 + 1)) / (W * H);
      if (x1 < 0 || kept < 0.03 || kept > 0.95) return ""; // nothing sensible left: keep the photo as it is
      const o = document.createElement("canvas"); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
      o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
      return o.toDataURL("image/png");
    } catch { return ""; }
  })());
  return cutCache.get(dataUrl);
}

// ---------- product: library first, then facts ----------
let sheet = null, handle = "";
let copy = null, mode = "", log = [];
let formats = [], drafts = [], items = {}, notShown = [], selected = "";
let inputs = {}, uploads = {}, aiValues = {};
// One number per Build per product (kept in this browser): the server rotates facts, headlines and images by it, so a new Build is never a repeat.
let variant = 0;
const nextVariant = () => {
  const key = `minimalist:variant:${handle || "manual"}`;
  let n = 0;
  try { n = Number(localStorage.getItem(key)) || 0; } catch { /* private window: counts for this page only */ }
  n = Math.max(n, variant) + 1;
  try { localStorage.setItem(key, String(n)); } catch { /* ignore */ }
  return n;
};
let gen = 0; // bumps on every new build or edit, so late answers from an older one are dropped

$("#manual-toggle").onclick = () => $("#manual-form").classList.toggle("hidden");
const handleFromUrl = (u) => (/^(https?:\/\/)?(www\.)?beminimalist\.co\//i.test(String(u).trim()) ? (String(u).match(/\/products\/([^/?#]+)/) || [])[1] || "" : "");

function showSheet(s, refusal, cached) {
  sheet = s;
  const rows = s.facts
    .map((f) => `<tr class="${["testimonial", "faq", "inci"].includes(f.kind) ? "excluded" : ""}"><td>${f.id}</td><td>${esc(f.kind)}</td><td>${esc(f.section)}</td><td>${esc(f.text)}</td></tr>`)
    .join("");
  $("#facts-body").innerHTML = `<p class="hint">${esc(s.title)} · actives from pack title: ${s.actives.map((a) => esc(a.pct + " " + a.name)).join(", ") || "none"} · source: ${s.source}${cached ? ` · page read ${esc(new Date(cached).toLocaleDateString())} (saved copy; tick "Re-read" to refresh)` : ""}. Greyed rows (testimonials, FAQ answers, full INCI) cannot be cited as claims; prices, offers, the rating and reviews are quoted only by the offer, price, rating and quote formats.</p><table>${rows}</table>`;
  $("#facts").classList.remove("hidden");
  $("#gen-controls").classList.remove("hidden");
  if (!online) $("#img-studio").classList.remove("hidden"); // the online version makes no new images
  $("#extract-msg").innerHTML = refusal ? `${esc(s.title)}: ${s.facts.length} facts.<div class="warnbox blocked"><b>Severe: every ad for this product</b> ${esc(refusal)}</div>` : `${esc(s.title)}: ${s.facts.length} facts.`;
  loadRequests();
}

$("#extract-form").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("#url").value;
  handle = handleFromUrl(url);
  $("#gen-result").classList.add("hidden");
  $("#extract-msg").textContent = "Opening product…";
  // Library first: the existing ads show while the facts load (nothing is generated).
  if (handle) loadLibrary(handle);
  try {
    const { sheet: s, refusal, cached } = await api("/api/extract", { url, useSaved: $("#useSaved").checked });
    if (!handle && s.slug) { handle = s.slug; loadLibrary(handle); } // another brand: its saved ads (if any) are looked up by its own name
    showSheet(s, refusal, cached);
  } catch (err) {
    $("#extract-msg").innerHTML = `<span class="err">${esc(err.message)}</span> You can enter the product manually instead.`;
    $("#manual-form").classList.remove("hidden");
  }
};

$("#manual-form").onsubmit = async (e) => {
  e.preventDefault();
  const manual = Object.fromEntries(new FormData(e.target));
  handle = "";
  if (libMode === "p") { $("#library").classList.add("hidden"); libVisible = false; syncHash(); }
  const { sheet: s, refusal } = await api("/api/extract", { manual });
  showSheet(s, refusal);
};

// ---------- existing ads: filters, sort and the "All ads" view (client-side, one fetched list; filters.js) ----------
let libMode = "p";      // "p" = this product's library, "all" = every product
let libHandle = "";     // the product whose library "This product" shows
let libVisible = false;
let libAds = [];        // the flat list for the current mode
let adState = adDefaults();
let adShown = [];       // what is on screen, in order (card clicks index into it)
let libSeq = 0, adTimer = null;

const loadLibrary = (h) => openLibrary("p", { h, state: adDefaults() });
$("#lib-all").onclick = async () => { $("#lib-details").open = true; await openLibrary("all", { state: adDefaults() }); $("#library").scrollIntoView({ behavior: "smooth", block: "start" }); };

async function openLibrary(mode, { h = libHandle, state = null } = {}) {
  const my = ++libSeq;
  libMode = mode;
  if (mode === "p") libHandle = h;
  libVisible = true;
  $("#library").classList.remove("hidden");
  $("#lib-body").innerHTML = '<p class="hint">Loading the ads…</p>';
  let ads = [];
  try {
    ads = mode === "all" ? (await api("/api/library-all")).ads : (await api(`/api/library?handle=${encodeURIComponent(libHandle)}`)).groups.flatMap((g) => g.ads);
  } catch (err) { $("#lib-body").innerHTML = `<p class="err">${esc(err.message)}</p>`; return; }
  if (my !== libSeq) return; // a newer open won
  libAds = ads;
  const products = new Set(ads.map((a) => a.handle)), formats = new Set(ads.map((a) => a.fmt));
  $("#lib-count").textContent = !ads.length ? "" : mode === "all" ? `(${ads.length} ads, ${products.size} products, ${formats.size} formats)` : `(${ads.length} ads in ${formats.size} formats)`;
  buildAdControls();
  adState = cleanAdState(state || adState);
  writeAdControls(adState);
  adState = readAdControls();
  renderLibrary();
  syncHash();
}

function fillSelect(sel, allLabel, opts) {
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>` + opts.map((o) => `<option value="${esc(o.key)}" data-label="${esc(o.label)}">${esc(o.label)}</option>`).join("");
}
function buildChecks(sel, name, opts) {
  const fs = $(sel);
  fs.querySelectorAll("label").forEach((l) => l.remove());
  fs.insertAdjacentHTML("beforeend", opts.map((o) => `<label class="fchip"><input type="checkbox" name="${name}" value="${esc(o.key)}" /> <span class="t">${esc(o.label)}</span> <span class="n"></span></label>`).join(""));
}
function buildAdControls() {
  const { products, formats } = adOptions(libAds);
  fillSelect($("#f-product"), "All products", products);
  fillSelect($("#f-fmt"), "All formats", formats);
  $("#f-sort").innerHTML = adSortsFor(libMode).map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join("");
  buildChecks("#f-verdict", "verdict", VERDICTS);
  buildChecks("#f-risk", "risk", RISKS);
  buildChecks("#f-size", "size", SIZES);
  $("#f-product-wrap").classList.toggle("hidden", libMode === "p");
  document.querySelectorAll('#lib-mode input').forEach((i) => { i.checked = i.value === libMode; if (i.value === "p") i.disabled = !libHandle; });
  for (const id of ["#f-exp", "#f-ai"]) for (const o of $(id).options) o.dataset.label = o.textContent;
}
function writeAdControls(s) {
  $("#f-q").value = s.q; $("#f-product").value = s.product; $("#f-fmt").value = s.fmt; $("#f-exp").value = s.exp; $("#f-ai").value = s.ai;
  $("#f-sort").value = s.sort || defaultAdSort(libMode);
  $("#f-align").value = s.align; $("#f-win").value = s.win;
  for (const [id, k] of [["#f-verdict", "verdict"], ["#f-risk", "risk"], ["#f-size", "size"]]) $(id).querySelectorAll("input").forEach((i) => (i.checked = s[k].includes(i.value)));
  sliderText();
}
function readAdControls() {
  const checked = (id) => [...$(id).querySelectorAll("input:checked")].map((i) => i.value);
  const sort = $("#f-sort").value;
  return cleanAdState({
    q: $("#f-q").value, product: libMode === "all" ? $("#f-product").value : "", fmt: $("#f-fmt").value,
    verdict: checked("#f-verdict"), risk: checked("#f-risk"), size: checked("#f-size"),
    exp: $("#f-exp").value, ai: $("#f-ai").value, align: $("#f-align").value, win: $("#f-win").value,
    sort: sort === defaultAdSort(libMode) ? "" : sort,
  });
}
function sliderText() {
  for (const k of ["align", "win"]) { const v = Number($(`#f-${k}`).value); $(`#f-${k}-out`).textContent = v ? `${v} or more` : "any"; }
}
// Counts beside every option: how many ads it would show with the other filters as they are now.
function setCounts(sel, counts) {
  $(sel).querySelectorAll("label").forEach((l) => { l.querySelector(".n").textContent = `(${counts[l.querySelector("input").value] || 0})`; });
}
function setSelectCounts(sel, counts) {
  for (const o of $(sel).options) if (o.value) o.textContent = `${o.dataset.label} (${counts[o.value] || 0})`;
}

// Ads that are not ready stay in the library with a plain warning (user, 2026-10-05: "bring back and give warning").
const WARN_WHY = {
  "CLM-01": "Disease or drug claim (treat, cure, heal): not allowed on a cosmetic.",
  "CLM-03": "Guarantee or absolute result: not allowed.",
  "CLM-05": "Safety absolute ('chemical-free', 'no side effects'): not allowed.",
  "CLM-06": "Fairness or skin-lightening claim: not allowed.",
  "CLM-10": "Claims a regulator's approval: not allowed.",
  "CLM-20": "Concentration doesn't match the product.",
  "OFR-01": "Price or discount doesn't match the site.",
  "CRE-01": "Creator ad without a paid-partnership label.",
  "AI-01": "AI-made image (Severe): India's ASCI rule on AI content prohibits AI result images even with a label, from about late December 2026. Replace with real, consented photos before use.",
  "CLM-12": "Comparison: attach the proof behind it (what was compared, how, source) before use.",
  "CLM-21": "Customer quote with their name: customer consent needed to show the name.",
  "CLM-24": "Body-function wording: describe the visible result instead.",
  "CLM-01": "Lab result worded like a medical claim: needs legal sign-off.",
  "CLM-19": "SPF figure differs from the pack: use the labelled SPF.",
};
function adWarning(a) {
  const v = a.scores?.verdict;
  // AI-made images are never blocked (DEC-07) but always carry a fair warning and their Severe rating.
  if ((!v || v === "READY_FOR_REVIEW") && (a.ai || (a.scores?.findings || []).some((f) => /AI-01/.test(String(f))))) return `<span class="warnbox fix"><b>Warning: AI-made image (Severe)</b> ${esc(WARN_WHY["AI-01"].replace(/^AI-made image \(Severe\): /, ""))}</span>`;
  if (!v || v === "READY_FOR_REVIEW") return "";
  const ids = [...new Set((a.scores.findings || []).map((f) => (String(f).match(/\b([A-Z]{2,4}-\d{2})\b/) || [])[1]).filter(Boolean))];
  const lead = (a?.scores?.findings || []).map(String).find((f) => /^block/.test(f)) || (a?.scores?.findings || []).map(String)[0] || "", lid = (lead.match(/\b([A-Z]{2,4}-\d{2})\b/) || [])[1], q = (lead.match(/"([^"]+)"/) || [])[1];
  const why = `${(lid && WARN_WHY[lid]) || ids.map((id) => WARN_WHY[id]).filter(Boolean)[0] || (lid ? `Rule ${lid}.` : "See the description.")}${q ? ` Flagged words: "${q}".` : ""}${lid ? ` (${lid})` : ""}`;
  return `<span class="warnbox ${v === "BLOCKED" ? "blocked" : "fix"}"><b>${v === "BLOCKED" ? "Blocked, do not use" : "Needs a fix before use"}</b> ${esc(why)}</span>`;
}
function adCard(a, i, flat) {
  return `<div class="lib-card">
          <button type="button" class="lib-open" data-i="${i}" title="Open" aria-label="Open ${esc(a.fmt_title)}, ${esc(a.product)}"><img src="${esc(a.png)}" alt="${esc(a.fmt_title)}" loading="lazy" /></button>
          ${flat ? `<span class="lib-where"><b>${esc(a.fmt_title)}</b><br>${esc(a.product)}</span>` : ""}
          <span class="chips"><span class="chip risk-${esc(a.risk)}">${esc(cap(a.risk) || "?")} risk</span><span class="chip ${a.exportable ? "ok" : "no"}">${a.exportable ? "Exportable" : "Not exportable"}</span>${a.ai ? '<span class="chip no">AI image</span>' : ""}</span>
          ${a.scores ? scoresCompact(libScores(a.scores)) : '<span class="hint small">Not scored yet</span>'}
          ${adWarning(a)}
          ${a.scores?.verdict === "BLOCKED" ? "" : `<span class="dlrow" title="Download PNG">${adSizes(a).map((s) => `<a class="dl" href="${esc(s.url)}" download="${esc(s.url.split("/").pop())}" title="Download ${esc(s.label)} PNG">${esc(s.label)}</a>`).join("")}</span>`}
          <span class="hint small">${esc(a.run)}</span>
        </div>`;
}

function renderLibrary() {
  const sorted = sortAds(filterAds(libAds, adState), adState.sort, libMode);
  adShown = sorted;
  const grouped = libMode === "p" && (adState.sort || defaultAdSort("p")) === "fmt";
  $("#lib-shown").textContent = libAds.length ? `${countText(sorted.length, libAds.length)}${libMode === "p" ? " for this product" : ""}` : "";
  $("#f-clear").disabled = !activeAdFilters(adState, libMode) && !adState.sort;
  let html;
  if (!libAds.length) html = `<p class="hint">${libMode === "p" ? "No saved ads for this product. Click Build new ads above." : "No ads in the library yet."}</p>`;
  else if (!sorted.length) html = `<p class="hint empty-note">No ads match these filters. <button type="button" class="ghost" data-clear>Clear filters</button></p>`;
  else if (!grouped) html = `<div class="lib-cards">${sorted.map((a, i) => adCard(a, i, true)).join("")}</div>`;
  else {
    const parts = [];
    sorted.forEach((a, i) => {
      if (!i || sorted[i - 1].fmt !== a.fmt) parts.push(`${i ? "</div></div>" : ""}<div class="lib-group"><h4>${esc(a.fmt_title)} <span class="hint">${esc(a.template)}</span></h4><div class="lib-cards">`);
      parts.push(adCard(a, i, false));
    });
    html = parts.join("") + "</div></div>";
  }
  $("#lib-body").innerHTML = html;
  $("#lib-body").querySelectorAll(".lib-open").forEach((b) => (b.onclick = () => { const a = adShown[b.dataset.i]; openLibraryAd({ title: a.fmt_title }, a); }));
  $("#lib-body").querySelector("[data-clear]")?.addEventListener("click", clearAdFilters);
  setCounts("#f-verdict", adFacetCounts(libAds, adState, "verdict"));
  setCounts("#f-risk", adFacetCounts(libAds, adState, "risk"));
  setCounts("#f-size", adFacetCounts(libAds, adState, "size"));
  setSelectCounts("#f-product", adFacetCounts(libAds, adState, "product"));
  setSelectCounts("#f-fmt", adFacetCounts(libAds, adState, "fmt"));
  setSelectCounts("#f-exp", adFacetCounts(libAds, adState, "exp"));
  setSelectCounts("#f-ai", adFacetCounts(libAds, adState, "ai"));
}

function clearAdFilters() {
  adState = adDefaults();
  writeAdControls(adState);
  renderLibrary();
  syncHash();
}
$("#f-clear").onclick = clearAdFilters;
$("#lib-filters").onsubmit = (e) => e.preventDefault();
// One listener: every control fires "input" (typing, sliders, ticks, dropdowns). Typing and sliders wait a moment.
$("#lib-filters").addEventListener("input", (e) => {
  adState = readAdControls();
  sliderText();
  clearTimeout(adTimer);
  adTimer = setTimeout(() => { renderLibrary(); syncHash(); }, ["search", "range"].includes(e.target.type) ? 120 : 0);
});
$("#lib-mode").addEventListener("change", (e) => {
  const mode = e.target.value;
  if (mode === libMode || (mode === "p" && !libHandle)) return;
  openLibrary(mode, { state: { ...adState, product: "", sort: "" } });
});

const cap = (s) => String(s || "").replace(/^./, (c) => c.toUpperCase());
// Library scores (scripts/score_library.js) in the shape the new-ad score widgets already draw.
const libScores = (s) => ({
  alignment: { score: s.alignment, band: s.alignment_band, parts: s.parts?.alignment },
  win: { score: s.win, band: s.win_band, parts: s.parts?.win },
  compliance: { score: s.compliance, code: s.verdict, label: s.verdict_label },
});
// Every size file this ad has: 1:1, 4:5, 9:16 and the language versions (hi, ta) when they exist.
const LANG = { hi: "Hindi", ta: "Tamil" };
const adSizes = (a) => [{ label: "1:1", url: a.png }, ...a.placements.map((p) => ({ label: LANG[p.label] || p.label, url: p.png }))];
function openLibraryAd(g, a) {
  const sizes = adSizes(a);
  const sc = a.scores;
  $("#viewer-body").innerHTML = `
    <div class="viewer-grid">
      <div>
        <img id="v-img" src="${esc(a.png)}" alt="" />
        <div class="sizes"><span class="hint">Preview</span><span class="sizebtns">${sizes.map((s, i) => `<button type="button" class="ghost size${i === 0 ? " on" : ""}" data-url="${esc(s.url)}">${esc(s.label)}</button>`).join("")}</span></div>
        <div class="sizes"><span class="hint">Download PNG</span><span class="sizebtns">${sizes.map((s) => `<a class="dlbtn" href="${esc(s.url)}" download="${esc(s.url.split("/").pop())}">${esc(s.label)}</a>`).join("")}</span></div>
      </div>
      <div>
        <p><span class="tag existing">Existing</span> <b>${esc(g.title)}</b>${a.product ? ` <span class="hint">${esc(a.product)}</span>` : ""}</p>
        <p class="chips"><span class="chip risk-${esc(a.risk)}">${esc(cap(a.risk))} risk</span><span class="chip ${a.exportable ? "ok" : "no"}">${a.exportable ? "Exportable" : "Not exportable"}</span></p>
        ${a.not_exportable_why ? `<p class="hint">${esc(a.not_exportable_why)}</p>` : ""}
        <p class="hint">${esc(a.template)} · run ${esc(a.run)} · ${esc(a.verdict)}</p>
        ${sc ? `${scoresBlock(libScores(sc))}<p class="hint"><b>Reviewed by:</b> ${esc(sc.reviewed_by || "not recorded")}</p>${sc.findings?.length ? `<ul class="hint">${sc.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}` : `<p class="hint">Scores not available for this ad yet (they are written by scripts/score_library.js).</p>`}
        <h3>On the image</h3><ul>${a.on_image.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <h3>Caption</h3><p>${esc(a.caption)}</p>
        <p class="row"><a href="${esc(a.md)}" target="_blank" rel="noopener">Full description</a></p>
      </div>
    </div>`;
  $("#viewer-body").querySelectorAll("button.size").forEach((b) => (b.onclick = () => {
    $("#v-img").src = b.dataset.url;
    $("#viewer-body").querySelectorAll("button.size").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $("#viewer").showModal();
}

// ---------- image studio requests (the app only queues and polls; it never calls an image API) ----------
let pollTimer = null;
async function loadRequests() {
  clearTimeout(pollTimer);
  if (!handle) { $("#img-requests").innerHTML = ""; return; }
  const { requests } = await api(`/api/image-requests?handle=${encodeURIComponent(handle)}`).catch(() => ({ requests: [] }));
  const STATUS = { queued: ["Queued", ""], working: ["Working", "st-wait"], done: ["Done", "ok"], needs_review: ["Needs review", "no"], failed: ["Failed", "no"] };
  $("#img-requests").innerHTML = requests.map((r) => {
    const [label, cls] = STATUS[r.status] || [cap(r.status), ""];
    const res = r.result, review = r.status === "needs_review";
    const body = res?.url
      ? `<p>${review ? '<span class="chip no">Warning</span> The pack label did not pass the check. Not offered for ads.' : '<span class="tag new">New</span> from the image studio'}${res.rounds ? `, ${esc(res.rounds)} round(s)` : ""}</p>
         <a href="${esc(res.url)}" target="_blank" rel="noopener"><img class="${review ? "warn" : ""}" src="${esc(res.url)}" alt="Result" /></a>
         <p class="hint">${esc(res.notes || "")}</p>
         <p class="row"><a class="dlbtn" href="${esc(res.url)}" download="${esc(r.id)}.png">Download PNG</a>${review ? `<a href="/img/image_requests/${encodeURIComponent(r.id)}_check.png" target="_blank" rel="noopener">See the label comparison</a>` : ""}</p>
         ${review ? "" : '<p class="hint">Any person in it is an AI model: Severe risk, needs the AI mark.</p>'}`
      : res?.notes ? `<p class="hint">${esc(res.notes)}</p>`
      : r.status === "working" ? `<p class="hint">${esc(r.progress || "ChatGPT is drawing it")}. This updates by itself.</p>`
      : `<p class="hint">Waiting for the image studio. If nothing happens, run <b>npm run studio</b> on this computer and sign in to ChatGPT in its window.</p>`;
    return `<div class="req"><div><span class="chip ${cls}">${esc(label)}</span> <span class="hint">${esc(new Date(r.requested_at).toLocaleString())}</span></div><p>${esc(r.prompt)}</p>${body}</div>`;
  }).join("");
  // A request that just finished adds its image to this product's image list.
  const finished = requests.filter((r) => ["done", "needs_review"].includes(r.status)).map((r) => r.id).join();
  lastFinished = finished;
  if (requests.some((r) => !["done", "failed", "needs_review"].includes(r.status))) pollTimer = setTimeout(loadRequests, 10000);
}
let lastFinished = "";
$("#img-queue").onclick = async () => {
  if (!handle) return ($("#img-msg").textContent = "Open a beminimalist.co product first.");
  $("#img-msg").textContent = "Queuing…";
  try {
    await api("/api/image-request", { handle, prompt: $("#img-prompt").value, sheet });
    $("#img-prompt").value = "";
    $("#img-msg").textContent = "Queued.";
    loadRequests();
  } catch (err) { $("#img-msg").textContent = err.message; }
};

// ---------- image library: every image we hold, searchable (GET /api/images) ----------
const imgChips = (e) => {
  const c = [`<span class="chip">${esc(IMG_TYPES[e.type] || e.type)}</span>`];
  if (e.type === "ai_scene") c.push('<span class="chip risk-severe">AI — Severe</span>');
  else if (e.ai) c.push('<span class="chip risk-medium">AI-made</span>');
  if (e.type === "review_photo") c.push('<span class="chip risk-medium">Reference only</span>');
  if (e.type === "requested" && e.status === "needs_review") c.push('<span class="chip no">Needs review</span>');
  if (e.type === "requested" && !["done", "needs_review"].includes(e.status)) c.push(`<span class="chip st-wait">${esc(e.status || "queued")}</span>`);
  return `<span class="chips">${c.join("")}</span>`;
};
const imgCard = (e, i) => `<button type="button" class="img-card" data-i="${i}" title="${esc(e.label)}"><img src="${esc(e.url)}" alt="${esc(e.label)}" loading="lazy" />${imgChips(e)}<span class="hint small">${esc(e.product || e.handle || "")}</span></button>`;

function openImage(e) {
  const canUse = usableInAds(e);
  $("#viewer-body").innerHTML = `
    <div class="viewer-grid">
      <img class="${e.type === "requested" && e.status === "needs_review" ? "warn" : ""}" src="${esc(e.url)}" alt="${esc(e.label)}" />
      <div>
        <p><b>${esc(e.label)}</b></p>
        ${imgChips(e)}
        <p class="hint">${esc(e.product || "")}${e.handle ? ` · ${esc(e.handle)}` : ""} · ${esc(e.file || "")}</p>
        <p>${esc(e.usage)}</p>
        ${e.prompt ? `<h3>Prompt</h3><p>${esc(e.prompt)}</p>` : ""}
        ${e.notes ? `<h3>Notes</h3><p class="hint">${esc(e.notes)}</p>` : ""}
        <p class="row">
          ${canUse ? `<button type="button" id="img-use">Make new ads for this product</button>` : ""}
          <a class="dlbtn" href="${esc(e.url)}" download="${esc(e.file || "image.png")}">Download</a>
          <a href="${esc(e.url)}" target="_blank" rel="noopener">Open full size</a>
          ${e.check_url ? `<a href="${esc(e.check_url)}" target="_blank" rel="noopener">Label comparison</a>` : ""}
        </p>
        ${canUse ? `<p class="hint">The ad builder picks the best verified pack image for this product by itself (cut-out of the verified render first), so this opens the product and builds from the same asset library.</p>` : `<p class="hint">${e.type === "requested" && e.status === "needs_review" ? "Needs review: not offered for ads." : "View or download only: the ad builder does not take this kind of image."}</p>`}
      </div>
    </div>`;
  $("#img-use")?.addEventListener("click", () => {
    $("#viewer").close();
    showTab("generate");
    $("#url").value = `https://beminimalist.co/products/${e.handle}`;
    $("#extract-form").requestSubmit();
  });
  $("#viewer").showModal();
}

$("#pi-open").onclick = async (ev) => { ev.preventDefault(); imgState = { ...imgDefaults(), product: handle }; showTab("images"); await imgReady; };

// The whole list is fetched once per visit to the tab; type chips, product, "usable in ads", search and sort all filter it here (filters.js).
let imgAll = [], imgState = imgDefaults(), imgList = [], imgShown = 0, imgInit = false, imgTimer = null;
const IMG_PAGE = 120;

function buildImageControls() {
  $("#img-types").insertAdjacentHTML("beforeend", IMG_GROUPS.map((g) => `<label class="fchip"><input type="checkbox" name="itype" value="${g.key}" /> <span class="t">${esc(g.label)}</span> <span class="n"></span></label>`).join(""));
  $("#img-sort").innerHTML = IMG_SORTS.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join("");
  $("#img-use").querySelectorAll("option").forEach((o) => (o.dataset.label = o.textContent));
  $("#img-search").addEventListener("input", (e) => {
    imgState = readImageControls();
    clearTimeout(imgTimer);
    imgTimer = setTimeout(() => { renderImages(); syncHash(); }, e.target.type === "search" ? 150 : 0);
  });
  $("#img-search").onsubmit = (e) => e.preventDefault();
  $("#img-clear").onclick = () => { imgState = imgDefaults(); writeImageControls(); renderImages(); syncHash(); };
  $("#img-more").onclick = showMoreImages;
}
function writeImageControls() {
  const s = imgState;
  $("#img-q").value = s.q; $("#img-handle").value = s.product; $("#img-use").value = s.use; $("#img-sort").value = s.sort;
  $("#img-types").querySelectorAll("input").forEach((i) => (i.checked = s.type.includes(i.value)));
}
function readImageControls() {
  return cleanImgState({ q: $("#img-q").value, product: $("#img-handle").value, use: $("#img-use").value, sort: $("#img-sort").value, type: [...$("#img-types").querySelectorAll("input:checked")].map((i) => i.value) });
}
function renderImages() {
  imgList = sortImages(filterImages(imgAll, imgState), imgState.sort);
  imgShown = 0;
  $("#img-grid").innerHTML = "";
  $("#img-count").textContent = !imgAll.length ? "No images in the library." : imgList.length ? countText(imgList.length, imgAll.length, "image") : "No images match these filters. Try fewer words, or clear the filters.";
  $("#img-clear").disabled = !activeImgFilters(imgState) && !imgState.sort;
  const typ = imgFacetCounts(imgAll, imgState, "type");
  $("#img-types").querySelectorAll("label").forEach((l) => { l.querySelector(".n").textContent = `(${typ[l.querySelector("input").value] || 0})`; });
  const prod = imgFacetCounts(imgAll, imgState, "product"), use = imgFacetCounts(imgAll, imgState, "use");
  for (const o of $("#img-handle").options) if (o.value) o.textContent = `${o.dataset.label} (${prod[o.value] || 0})`;
  for (const o of $("#img-use").options) if (o.value) o.textContent = `${o.dataset.label} (${use[o.value] || 0})`;
  showMoreImages();
}
function showMoreImages() {
  const from = imgShown;
  imgShown = Math.min(imgList.length, imgShown + IMG_PAGE);
  $("#img-grid").insertAdjacentHTML("beforeend", imgList.slice(from, imgShown).map((e, k) => imgCard(e, from + k)).join(""));
  $("#img-grid").querySelectorAll(".img-card:not([data-bound])").forEach((b) => { b.dataset.bound = "1"; b.onclick = () => openImage(imgList[b.dataset.i]); });
  $("#img-more").classList.toggle("hidden", imgShown >= imgList.length);
  $("#img-more").textContent = `Show more (${imgList.length - imgShown} left)`;
}
let imgReady = Promise.resolve();
function initImageLibrary() {
  if (!imgInit) { imgInit = true; buildImageControls(); }
  imgReady = refreshImages(); // every visit: new studio images may have arrived
  return imgReady;
}
async function refreshImages() {
  $("#img-count").textContent = "Loading…";
  try { imgAll = await api("/api/images"); } catch (err) { $("#img-count").textContent = err.message; return; }
  $("#img-handle").innerHTML = `<option value="">All products</option>` + imgProductOptions(imgAll).map((o) => `<option value="${esc(o.key)}" data-label="${esc(o.label)}">${esc(o.label)}</option>`).join("");
  writeImageControls();
  imgState = readImageControls();
  renderImages();
  syncHash();
}

// ---------- new ads: every format, ranked, rendered progressively ----------
const fmtOf = (id) => formats.find((f) => f.id === id) || drafts.find((f) => f.id === id);

async function hydrate(id) {
  const it = items[id], spec = it.spec, up = uploads[id] || {};
  const s = { ...spec, cutoutHrefs: [], groundedHrefs: [] };
  // A product-page photo on a coloured studio backdrop (no verified render yet) is cut out here, so every ad sits on
  // the same white canvas (user, 2026-10-05: "different background, this is not acceptable").
  const asCut = async (src, cutout) => {
    let href = await dataUrlOf(src);
    let white = false;
    if (href && !cutout) { const c = await autoWhite(href); if (c) { href = c; white = true; } }
    if (cutout && href) s.cutoutHrefs.push(href); else if (href && !white) s.rawPhotoHref = s.rawPhotoHref || href;
    return href;
  };
  s.imageHref = await asCut(spec.imageSrc, spec.cutout);
  for (const k of ["steps", "range"]) {
    s[k] = await Promise.all((spec[k] || []).map(async (x) => ({ ...x, imageHref: await asCut(x.imageSrc, x.cutout) })));
  }
  if (spec.textureSrc) s.textureHref = await dataUrlOf(spec.textureSrc);
  // The product's own AI images (no upload needed): person, before/after and progress frames from the library's runs. An uploaded photo replaces them.
  if (spec.personSrc && !up.person) s.personHref = await dataUrlOf(spec.personSrc);
  if (spec.photoSrcs?.length && !(up.before && up.after)) s.photos = await Promise.all(spec.photoSrcs.map((u) => dataUrlOf(u)));
  if (spec.frames?.some((f) => f.imageSrc)) s.frames = await Promise.all(spec.frames.map(async (f) => ({ ...f, imageHref: await dataUrlOf(f.imageSrc) })));
  if (up.texture) s.textureHref = up.texture;
  if (up.person) s.personHref = up.person;
  if (up.before && up.after) s.photos = [up.before, up.after];
  // White canvas when every pack is a clean cut-out (as in the library); else the photo's own studio colour.
  // White canvas whenever every pack is a cut-out (verified, from the library, or cut here); else the photo's own colour.
  s.canvas = s.rawPhotoHref ? (await cornerColour(s.rawPhotoHref)) || "#FFFFFF" : "#FFFFFF";
  // Several packs side by side (range / steps) always share one white background (user, 2026-10-05: "all should be on the same background").
  if (spec.textureScene || spec.range?.length || spec.steps?.length) s.canvas = "#FFFFFF"; // the texture shot sits on white, as in pipeline/08_compose.js
  return s;
}

const thumbUrls = {};
// A format whose image is still being made (or can't be): a loading card, never an ad with something drawn in its place.
const pendingCard = (p) => `<span class="pending ${esc(p.state)}"><b>${p.state === "making" ? "Making a new image…" : p.state === "failed" ? "New image failed" : "New image needs the Image Studio"}</b><small>${esc(p.text.replace(/^New image needs the Image Studio: /, ""))}${p.progress ? " " + esc(p.progress) : ""}</small></span>`;
async function drawThumb(id) {
  const it = items[id];
  if (!it) return;
  if (fmtOf(id)?.pending) {
    const card = $(`#strip [data-id="${id}"]`);
    // No empty slots (user, 2026-10-05: "there are still many placeholders"): an ad whose new image isn't ready is not
    // shown at all; it appears in the grid once its image arrives (the poll redraws it). The header counts what's coming.
    if (card) card.hidden = true;
    updatePendingNote();
    return;
  }
  { const c = $(`#strip [data-id="${id}"]`); if (c) c.hidden = false; updatePendingNote(); }
  const svg = renderAdSvg(await hydrate(id));
  if (thumbUrls[id]) URL.revokeObjectURL(thumbUrls[id]);
  thumbUrls[id] = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const card = $(`#strip [data-id="${id}"]`);
  if (card) card.querySelector(".tim").innerHTML = `<img src="${thumbUrls[id]}" alt="" />`;
  updateThumbInfo(id);
}

// One quiet line under the grid instead of placeholder tiles: "3 more ads are being made (new images from the Image Studio)".
function updatePendingNote() {
  let note = $("#pending-note");
  if (!note) { note = document.createElement("p"); note.id = "pending-note"; note.className = "hint"; $("#strip").after(note); }
  const making = formats.filter((f) => f.pending && !["failed", "unavailable"].includes(f.pending.state)).length;
  const forRender = formats.some((f) => f.pending && /product render/.test(f.pending.text || ""));
  // A loading status for every ad still being made (user, 2026-10-05): its name and where its image is (queued, drawing,
  // label check round n of 3). No empty tile is shown; each ad appears in the grid when ready.
  const rows = formats.filter((f) => f.pending && !["failed", "unavailable"].includes(f.pending.state)).map((f) => `<li><span class="spin"></span><b>${esc(f.label)}</b> <span class="hint">${esc(f.pending.progress || (f.pending.text || "").replace(/…$/, "") || "Queued")}</span></li>`);
  // Nothing can make images right now (no OpenAI key, no ChatGPT window running): ask for the keys instead of waiting.
  const noStudio = formats.some((f) => f.pending?.state === "no_studio");
  if (noStudio) { note.innerHTML = `<div class="warnbox fix"><b>${making} ads need new images, and nothing is set up to make them.</b> Add your OpenAI API key (images) and your Claude API key (copy and the AI judge), or run <code>npm run studio</code> and sign in to ChatGPT. <button type="button" class="ghost" id="ask-keys">Add API keys</button></div>`; $("#ask-keys").onclick = () => $("#settings").showModal(); return; }
  note.innerHTML = !making ? "" : `<p>${esc(forRender ? `Making the label-checked product render first (ChatGPT, checked against the real pack, up to 3 tries; 1–3 minutes). ${making} ads appear here once it passes.` : `${making} more ad${making > 1 ? "s are" : " is"} being made, up to 3 at a time. Each appears here when its image is ready.`)}</p><ul class="loading-list">${rows.join("")}</ul>`;
  return;
  note.textContent = !making ? "" : forRender ? `Making the label-checked product render first (ChatGPT, checked against the real pack, up to 3 tries; 1–3 minutes). ${making} ads appear here once it passes.` : `${making} more ad${making > 1 ? "s are" : " is"} being made: each appears here when its new image is ready (about a minute each).`;
}

function stateOf(id) {
  const f = fmtOf(id), it = items[id];
  if (!it) return { cls: "wait", text: "Rendering…" };
  if (f.pending) return { cls: f.pending.state === "making" ? "wait" : "need", text: f.pending.state === "making" ? "Making a new image…" : f.pending.state === "failed" ? "Image failed" : "Needs Image Studio" };
  if (f.image_review) return { cls: "BLOCKED", text: "Needs review" };
  if (f.status === "needs_input") return { cls: "need", text: "Needs input" };
  if (it.judging) return { cls: "wait", text: "AI check…" };
  const code = it.report.scores?.compliance?.code === "BLOCKED" ? "BLOCKED" : it.report.verdict.code;
  return { cls: code, text: VERDICT_SHORT[code] || code };
}
function updateThumbInfo(id) {
  const card = $(`#strip [data-id="${id}"]`), f = fmtOf(id);
  if (!card || !f) return;
  const st = stateOf(id), sc = items[id]?.report?.scores;
  // One small coloured dot (risk + verdict, in its tooltip) and three small scores on one line.
  const bad = ["BLOCKED"].includes(st.cls) || ["high", "severe"].includes(f.risk), warn = ["need", "NEEDS_CHANGES"].includes(st.cls) || f.risk === "medium";
  const dot = st.cls === "wait" ? "grey" : bad ? "red" : warn ? "amber" : "green";
  const line = f.pending ? esc(st.text) : sc ? [sc.alignment && `Fit ${pct(sc.alignment.score)}`, sc.win && `Win ${pct(sc.win.score)}`, sc.compliance && `Comp ${sc.compliance.score != null ? pct(sc.compliance.score) : esc(sc.compliance.label || sc.compliance.code)}`].filter(Boolean).join(" · ") : "";
  card.querySelector(".tinfo").innerHTML = `
    <span class="tlab"><span class="dot ${dot}" title="${esc(f.risk_label)} risk · ${esc(st.text)}"></span>${esc(f.label)}</span>
    <span class="tscores">${line}</span>`;
}

function renderStrip() {
  $("#strip").innerHTML = formats.map((f) => `<button type="button" class="thumb${f.id === selected ? " on" : ""}" data-id="${f.id}" role="option" aria-selected="${f.id === selected}"${f.pending ? " hidden" : ""}>
      <span class="tim"><span class="skel"></span></span><span class="tinfo"></span></button>`).join("");
  $("#strip").querySelectorAll(".thumb").forEach((b) => (b.onclick = () => select(b.dataset.id)));
  formats.forEach((f) => updateThumbInfo(f.id));
  updatePendingNote();
  $("#not-shown").onclick = (e) => { const a = e.target.closest(".fillin"); if (a) { e.preventDefault(); select(a.dataset.id); $("#preview").scrollIntoView({ behavior: "smooth" }); } };
  $("#not-shown").innerHTML = notShown.length ? `Not offered for this product: ${notShown.map((n) => `<b>${esc(n.label)}</b> (${esc(n.why)})${n.draft ? ` <a href="#" class="fillin" data-id="${esc(n.id)}">fill in</a>` : ""}`).join("; ")}.` : "";
}

function select(id) {
  selected = id;
  document.querySelectorAll("#strip .thumb").forEach((b) => { b.classList.toggle("on", b.dataset.id === id); b.setAttribute("aria-selected", b.dataset.id === id); });
  drawMain();
}

// Sizes: each is drawn natively in its own frame from the same approved copy and layout (same recipe as the library,
// pipeline/08_compose.js; 2026-10-27).
let previewSize = "1x1";
const placementOf = (key) => PLACEMENTS.find((p) => p.key === key) || PLACEMENTS[0];
function svgFor(spec, key) {
  return renderAdSvg(spec, placementOf(key).h);
}
function drawSizeButtons(blocked) {
  $("#size-preview").innerHTML = PLACEMENTS.map((p) => `<button type="button" class="ghost size${p.key === previewSize ? " on" : ""}" data-size="${p.key}">${p.label}</button>`).join("");
  $("#size-dl").innerHTML = PLACEMENTS.map((p) => `<button type="button" class="dlbtn" data-dl="${p.key}"${blocked ? " disabled" : ""} title="Download ${p.label} PNG (${p.w}×${p.h})">${p.label}</button>`).join("");
  $("#size-preview").querySelectorAll("button").forEach((b) => (b.onclick = () => { previewSize = b.dataset.size; drawMain(); }));
  $("#size-dl").querySelectorAll("button").forEach((b) => (b.onclick = () => downloadSize(b.dataset.dl)));
}

// Why export is off for this format, if it is.
function exportBlock(id) {
  const f = fmtOf(id), it = items[id];
  if (!f || !it) return "Still rendering.";
  if (f.pending) return "Export disabled: the new image is not ready yet.";
  if (f.image_review) return "Export disabled: the pack label in the new image did not pass the check. Needs review.";
  if (f.status === "needs_input") return `Draft: still needs ${f.missing.join(", ")}. Fill it in above, then it can be checked and exported.`;
  if (it.report.verdict.code === "BLOCKED" || it.report.scores?.compliance?.code === "BLOCKED") return "Export disabled: the ad has a blocking finding. Fix it and re-check.";
  if (f.risk === "severe") return "Export disabled: Severe risk (a person, hands or skin photo is used). Kept for review until a reviewer confirms real, consented photos.";
  return "";
}

async function drawMain() {
  const id = selected, f = fmtOf(id), it = items[id];
  if (!f || !it) return;
  const myGen = gen;
  const spec = f.pending ? null : await hydrate(id);
  if (myGen !== gen || id !== selected) return;
  $("#preview").innerHTML = f.pending ? `<div class="pending big">${pendingCard(f.pending)}</div>` : svgFor(spec, previewSize);
  const block = exportBlock(id);
  drawSignoff(id, block);
  drawSizeButtons(Boolean(block) || !signedOff(id));
  $("#export-note").textContent = block || (signedOff(id) ? `Signed off by ${signoff[id].name}, line by line. The review ticket records it.` : "Download unlocks once a reviewer has ticked every line above against its source. This is not an approval.");
  $("#fmt-head").innerHTML = `
    <h3 class="fmt-title"><span class="tag new">New</span> #${f.rank} ${esc(f.label)}</h3>
    <p class="chips"><span class="chip risk-${f.risk}">${esc(f.risk_label)} risk</span>${f.status === "needs_input" ? '<span class="chip st-need">Needs input</span>' : ""}${f.image_review ? '<span class="chip no">Warning: label check failed, not exportable</span>' : ""}${it.judging ? '<span class="chip st-wait">AI check running…</span>' : ""}</p>
    <p class="hint">${f.template ? `Catalog format #${f.template.id} ${esc(f.template.name)} · ranked by the same scoring as the library: ${esc(f.template.why)}.` : ""} ${esc(f.risk_note)}${f.visual ? ` Product image: ${esc(f.visual)}.` : ""}${f.image_note ? ` New image: ${esc(f.image_note)}` : ""}</p>`;
  if (f.status === "needs_input") $("#gen-report").innerHTML = `<div class="verdict DRAFT"><b>Draft — needs input</b><span>Still missing: ${esc(f.missing.join(", "))}. Empty slots show as [brackets] on the image and are not scored. Anything already filled is checked below.</span></div><div id="draft-report"></div>`;
  renderReport(it.report, f.status === "needs_input" ? $("#draft-report") : $("#gen-report"));
  drawNeeds(id);
  $("#gen-log").innerHTML = log.length ? `<details><summary>Generation log (${esc(mode)} copy)</summary><pre>${esc(JSON.stringify(log, null, 2))}</pre></details>` : `<p class="hint">Copy: ${esc(mode)}.</p>`;
}

// What this format still needs, and how to supply it: typed lines, an AI draft with citations, or a real photo.
function drawNeeds(id) {
  const f = fmtOf(id), el = $("#needs");
  const show = f.fields.length || f.photos.length || f.notes.length || f.missing.length;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const field = (x) => x.options
    ? `<label>${esc(x.label)}<select data-key="${esc(x.key)}" class="sel">${x.options.map((o) => `<option value="${esc(o.value)}"${o.value === x.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`
    : `<label>${esc(x.label)}${x.cited ? ' <span class="chip ok">from the page</span>' : x.typed ? ' <span class="chip risk-medium">typed, no source yet</span>' : ""}<input data-key="${esc(x.key)}" value="${esc(x.value)}"${x.max ? ` maxlength="${x.max}"` : ""} /></label>`;
  const photo = (p) => `<label>${esc(p.label)} ${p.have ? '<span class="chip ok">added</span>' : ""}<input type="file" accept="image/png,image/jpeg,image/webp" data-photo="${esc(p.key)}" /></label>`;
  el.innerHTML = `
    <h4>${f.missing.length ? "This format still needs" : "Lines and photos for this format"}</h4>
    ${f.missing.length ? `<ul class="missing">${f.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    ${f.notes.map((n) => `<p class="hint">${esc(n)}</p>`).join("")}
    ${f.person ? `<p class="hint">Any person, hands or skin photo is treated as an AI model, exactly like the library: it carries the "AI-GENERATED — ILLUSTRATIVE" mark and Severe risk. The product itself is always the real pack, composited by the app.</p>` : ""}
    <div class="needs-fields">${f.fields.map(field).join("")}${f.photos.map(photo).join("")}</div>
    <div class="row">
      ${f.fields.some((x) => !x.options) ? `<button type="button" id="apply-inputs">Apply and re-check</button>` : ""}
      ${f.ai_draft ? `<button type="button" id="ai-draft" class="ghost"${llm ? "" : ' disabled title="Needs a Claude API key (top right)"'}>Write the missing lines with AI (cited to the page)</button>` : ""}
      <span id="needs-msg" class="hint"></span>
    </div>`;
  const collect = () => {
    const values = {};
    el.querySelectorAll("input[data-key]").forEach((i) => (values[i.dataset.key] = i.value));
    el.querySelectorAll("select[data-key]").forEach((s) => (values[s.dataset.key] = s.value));
    return values;
  };
  const apply = (values) => {
    const prev = inputs[id] || {};
    // AI-drafted lines keep their citations only while unchanged; anything edited counts as typed.
    const cites = {};
    for (const [k, c] of Object.entries(prev.aiCites || {})) if (values[k] === aiValues[id]?.[k]) cites[k] = c;
    inputs[id] = { ...prev, values, cites };
    return rescoreOne(id);
  };
  el.querySelector("#apply-inputs")?.addEventListener("click", () => apply(collect()));
  // Picking another offer / question replaces the lines that came with the old one.
  el.querySelectorAll("select.sel").forEach((s) => s.addEventListener("change", () => apply({ [s.dataset.key]: s.value })));
  el.querySelectorAll("input[data-photo]").forEach((inp) => inp.addEventListener("change", async () => {
    const file = inp.files[0];
    if (!file) return;
    uploads[id] = { ...(uploads[id] || {}), [inp.dataset.photo]: await shrink(file) };
    const prev = inputs[id] || {};
    inputs[id] = { ...prev, photos: { ...(prev.photos || {}), [inp.dataset.photo]: true } };
    rescoreOne(id);
  }));
  el.querySelector("#ai-draft")?.addEventListener("click", async () => {
    $("#needs-msg").textContent = "Writing from the page facts…";
    try {
      const out = await api("/api/draft", { copy, sheet, format: id, inputs });
      aiValues[id] = out.values;
      inputs[id] = { ...(inputs[id] || {}), values: { ...collect(), ...out.values }, cites: out.cites, aiCites: out.cites };
      await rescoreOne(id);
      $("#needs-msg").textContent = out.problems.length ? `Some lines were dropped because they didn't match the page: ${out.problems.join("; ")}` : "Written and checked against the page.";
    } catch (err) { $("#needs-msg").textContent = err.message; }
  });
}

// Uploaded photos are scaled to at most 1600px so the page and the PNG stay light.
async function shrink(file) {
  const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
  const img = new Image(); img.src = url; await img.decode();
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

// One format again (after inputs or photos), with the AI judge when a key is set.
async function rescoreOne(id, { rulesOnly = !llm } = {}) {
  const myGen = gen;
  if (items[id]) items[id].judging = !rulesOnly;
  updateThumbInfo(id);
  if (id === selected) $("#needs-msg") && ($("#needs-msg").textContent = "Checking…");
  try {
    const out = await api("/api/rescore", { copy, sheet, format: id, inputs, rulesOnly, variant });
    if (myGen !== gen) return;
    const i = formats.findIndex((f) => f.id === id), di = drafts.findIndex((f) => f.id === id);
    if (i >= 0) formats[i] = { ...out.meta, rank: formats[i].rank };
    else if (di >= 0) drafts[di] = out.meta;
    items[id] = { spec: out.spec, report: out.report, judged: !rulesOnly };
  } catch (err) {
    if (items[id]) items[id].judging = false;
    if (id === selected) $("#export-note").textContent = err.message;
  }
  await drawThumb(id);
  if (id === selected) drawMain();
}

// The AI judge, one call per format, three at a time, best-ranked first (the one on screen jumps the queue).
function judgeAll() {
  if (!llm) return;
  const myGen = gen;
  const queue = formats.filter((f) => f.status === "ready" && !items[f.id]?.judged).map((f) => f.id).sort((a, b) => (b === selected) - (a === selected));
  let running = 0, done = 0;
  const total = queue.length;
  const next = () => {
    if (myGen !== gen) return;
    $("#gen-progress").textContent = done < total ? `AI judge: ${done} of ${total} formats checked…` : `All ${total} ready formats checked by the AI judge.`;
    while (running < 3 && queue.length) {
      const id = queue.shift();
      running++;
      rescoreOne(id, { rulesOnly: false }).finally(() => { running--; done++; next(); });
    }
  };
  next();
}

function fillEditor(c) {
  $("#e-headline").value = c.headline;
  $("#e-subhead").value = c.subhead;
  $("#e-proofs").value = c.proof_points.join("\n");
  $("#e-footnote").value = c.footnote;
  $("#e-cta").value = c.cta;
}

// One honest status line: ready / still being made / needing typed input are three different things.
function progressLine() {
  const ready = formats.filter((f) => f.status === "ready").length, waitKeys = formats.filter((f) => f.pending?.state === "no_studio").length, making = formats.filter((f) => f.pending).length - waitKeys, input = formats.filter((f) => !f.pending && f.status !== "ready").length;
  $("#gen-progress").textContent = [`${ready} ready`, making ? `${making} being made` : "", waitKeys ? `${waitKeys} waiting for an API key` : "", input ? `${input} need input` : ""].filter(Boolean).join(", ") + `.${llm ? "" : " Rules-only check (add a Claude API key for the AI judge)."}`;
  // Nothing ready yet: no big preview or scores for an ad that can't be seen (no placeholder), just the waiting line.
  document.querySelector("#gen-result .result")?.classList.toggle("hidden", !ready);
  if (ready && fmtOf(selected)?.pending) select(formats.find((f) => f.status === "ready").id);
}

// Shows a freshly built set: the first format large at once, then the strip fills in, then the AI judge (if on).
async function showBuild(out, t0) {
  formats = out.formats; drafts = out.drafts || []; items = Object.fromEntries(Object.entries(out.items).map(([k, v]) => [k, { ...v, judged: false }])); notShown = out.notShown;
  formats.forEach((f, i) => (f.rank = i + 1));
  if (!fmtOf(selected) || fmtOf(selected).pending) selected = formats.find((f) => f.status === "ready")?.id || out.format || formats[0].id;
  $("#gen-result").classList.remove("hidden");
  if ($("#variant-tag")) $("#variant-tag").textContent = variant ? `Variant ${variant}` : "";
  renderStrip();
  progressLine();
  await drawMain();
  await drawThumb(selected);
  if (t0) $("#gen-progress").textContent = `First ad shown in ${((performance.now() - t0) / 1000).toFixed(1)} s. Rendering the other ${formats.length - 1} formats…`;
  const myGen = gen;
  for (const f of formats) {
    if (myGen !== gen) return;
    if (f.id !== selected) { await drawThumb(f.id); await new Promise((r) => setTimeout(r, 0)); }
  }
  progressLine();
  judgeAll();
  pollImages();
}
// Every few seconds, formats waiting for a new image are re-read; the card swaps to the finished ad by itself.
let imgPoll = null, renderSeen = false;
function pollImages() {
  clearTimeout(imgPoll);
  const myGen = gen, rid = inputs.requests?.render;
  if (rid && !renderSeen) {
    clearTimeout(imgPoll);
    imgPoll = setTimeout(async () => {
      if (myGen !== gen) return;
      const r = ((await api(`/api/image-requests?handle=${encodeURIComponent(handle)}`).catch(() => ({ requests: [] }))).requests || []).find((x) => x.id === rid);
      if (r && ["done", "needs_review", "failed"].includes(r.status)) { renderSeen = true; if (r.status === "done") await showBuild(await api("/api/formats", { copy, sheet, inputs, variant })); else pollImages(); return; }
      pollImages();
    }, 6000);
    return;
  }
  const waiting = formats.filter((f) => f.pending && f.pending.state !== "failed" && f.pending.state !== "unavailable");
  if (!waiting.length) return;
  imgPoll = setTimeout(async () => {
    if (myGen !== gen) return;
    await Promise.all(waiting.map((f) => rescoreOne(f.id, { rulesOnly: true })));
    progressLine();
    pollImages();
  }, 6000);
}

$("#settings-btn").onclick = () => $("#settings").showModal();
// Keys are required to build (user, 2026-10-05: "if api keys not entered throw an error and ask for keys"): a Claude key
// for the copy and the AI judge, and an OpenAI key for images (a signed-in ChatGPT window, npm run studio, also makes
// images). Missing keys stop the build with an error and open the key box. "Continue without" is an explicit choice.
let keysWaived = false;
async function missingKeys() {
  const s = await api("/api/status").catch(() => ({}));
  showStatus(s);
  // Online, images aren't made at all, so only the Claude key is asked for.
  return [!s.llm ? "Claude API key (writes the copy, runs the AI judge)" : "", !s.online && !s.openai && !s.studio ? "OpenAI API key (makes the images)" : ""].filter(Boolean);
}
$("#generate").onclick = async () => {
  const miss = keysWaived ? [] : await missingKeys();
  if (miss.length) {
    $("#extract-msg").innerHTML = `<div class="warnbox blocked"><b>Can't build yet: API key${miss.length > 1 ? "s" : ""} missing.</b> ${miss.map(esc).join("; ")}. <button type="button" class="ghost" id="ask-keys2">Add API keys</button> <a href="#" id="waive-keys">Continue without them</a> <span class="hint">(copy word for word from the page, rules-only check${miss.some((m) => /OpenAI/.test(m)) ? ", no new images" : ""})</span></div>`;
    $("#ask-keys2").onclick = () => $("#settings").showModal();
    $("#waive-keys").onclick = (e) => { e.preventDefault(); keysWaived = true; $("#generate").click(); };
    $("#settings").showModal();
    return;
  }
  const t0 = performance.now();
  gen++;
  inputs = {}; uploads = {}; aiValues = {}; selected = ""; renderSeen = false;
  $("#extract-msg").textContent = $("#mode").value === "model" ? "Writing the copy (the model takes a few seconds), then building every format…" : "Building every format…";
  try {
    variant = nextVariant();
    const out = await api("/api/generate", { sheet, mode: $("#mode").value, variant });
    if (out.refused) return ($("#extract-msg").innerHTML = `<div class="refusal">${esc(out.reason)}</div>`);
    copy = out.copy; mode = out.mode; log = out.log || [];
    inputs = { requests: out.requests || {} }; renderSeen = false;
    fillEditor(copy);
    // Who the page says the product is for; the scene images rotate across these audiences.
    $("#extract-msg").innerHTML = (out.audiences || []).length ? `<p class="hint">Audiences from the product page: ${out.audiences.map((a) => `<b>${esc(a.label)}</b>${a.cites.length ? ` (${esc(a.cites.join(", "))})` : ""}`).join(" · ")}. New scene images rotate across them.</p>` : "";
    await showBuild(out, t0);
    $("#gen-result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    $("#extract-msg").innerHTML = `<span class="err">${esc(err.message)}</span>`;
  }
};

$("#recheck").onclick = async () => {
  copy = {
    headline: $("#e-headline").value.trim(),
    subhead: $("#e-subhead").value.trim(),
    proof_points: $("#e-proofs").value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3),
    footnote: $("#e-footnote").value.trim(),
    cta: $("#e-cta").value,
  };
  log.push({ step: "marketer edited copy and re-checked every format" });
  gen++;
  try {
    await showBuild(await api("/api/formats", { copy, sheet, inputs, variant }));
  } catch (err) { $("#export-note").textContent = err.message; }
};

// Per-line reviewer sign-off (DeepSeek review: "Ready for human review" must not drift into "approved"; user 2026-10-05:
// "fix these as well"). Before any download, a named reviewer ticks every line on the image and in the caption as checked
// against its source. The ticket records who signed and which lines. Edits clear it. Held in this page only.
const signoff = {};
const signLines = (id) => { const ad = items[id]?.report?.ad || {}; return [ad.headline, ...String(ad.on_image_text || "").split("\n"), ad.footnote, ad.primary_text].map((s) => String(s || "").trim()).filter(Boolean); };
const signedOff = (id) => { const s = signoff[id], n = signLines(id).length; return Boolean(s && s.name.trim() && s.lines.length === n && s.lines.every(Boolean) && s.key === signLines(id).join("\n")); };
function drawSignoff(id, block) {
  let box = $("#signoff");
  if (!box) { box = document.createElement("details"); box.id = "signoff"; box.className = "signoff"; $("#export-note").before(box); }
  if (block) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const lines = signLines(id), key = lines.join("\n");
  if (!signoff[id] || signoff[id].key !== key) signoff[id] = { name: signoff[id]?.name || "", lines: lines.map(() => false), key };
  const s = signoff[id];
  box.open = !signedOff(id);
  box.innerHTML = `<summary>Reviewer sign-off ${signedOff(id) ? "(done)" : `(${s.lines.filter(Boolean).length} of ${lines.length} lines)`}</summary>
    <p class="hint">Tick each line once you have checked it against its source (product page, study, offer terms). Download stays off until every line is ticked.</p>
    ${lines.map((l, i) => `<label class="signline"><input type="checkbox" data-i="${i}"${s.lines[i] ? " checked" : ""}> ${esc(l)}</label>`).join("")}
    <label class="signline">Reviewer name <input type="text" id="signer" value="${esc(s.name)}" placeholder="Your name"></label>`;
  box.querySelectorAll("input[type=checkbox]").forEach((c) => (c.onchange = () => { s.lines[+c.dataset.i] = c.checked; refreshSign(id); }));
  box.querySelector("#signer").oninput = (e) => { s.name = e.target.value; refreshSign(id); };
}
function refreshSign(id) {
  const ok = signedOff(id);
  $("#size-dl").querySelectorAll("button").forEach((b) => (b.disabled = Boolean(exportBlock(id)) || !ok));
  $("#signoff summary").textContent = `Reviewer sign-off ${ok ? "(done)" : `(${signoff[id].lines.filter(Boolean).length} of ${signoff[id].lines.length} lines)`}`;
  $("#export-note").textContent = ok ? `Signed off by ${signoff[id].name}, line by line. The review ticket records it.` : "Download unlocks once a reviewer has ticked every line above against its source. This is not an approval.";
}

async function downloadSize(key) {
  if (exportBlock(selected) || !signedOff(selected)) return;
  const p = placementOf(key), id = selected;
  const svg = svgFor(await hydrate(id), key);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await img.decode();
  const c = document.createElement("canvas");
  c.width = p.w;
  c.height = p.h;
  c.getContext("2d").drawImage(img, 0, 0, p.w, p.h);
  c.toBlob((b) => download(b, `${slug()}_${id}_${p.w}x${p.h}.png`), "image/png");
}

$("#dl-ticket").onclick = () => download(new Blob([ticket()], { type: "text/markdown" }), `${slug()}_${selected}_review-ticket.md`);

const slug = () => (sheet?.title || "ad").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function ticket() {
  const f = fmtOf(selected), r = items[selected].report, c = copy;
  const cites = c.citations ? (k) => (c.citations[k] || []).join(", ") || "—" : () => "edited by marketer (uncited)";
  const sc = r.scores;
  const lines = [
    `# Review ticket — ${sheet.title}`,
    ``,
    `- Product page: ${sheet.url || "manual entry (unverified)"}`,
    `- Verdict from pre-screen: **${r.verdict.label}** — ${r.verdict.detail}`,
    `- Checked: ${r.coverage.model ? "rules + model" : "rules only"} · rules v${r.coverage.rules_version} · ${r.scored_at}`,
    `- Copy mode: ${mode}`,
    `- Format: ${f.label}${f.template ? ` (catalog #${f.template.id} ${f.template.name}, ranked #${f.rank} for this product)` : ""}`,
    `- Risk: ${f.risk_label} — ${f.risk_note}`,
    sc ? `- Scores: brand alignment ${pct(sc.alignment?.score)}, chance to win ${pct(sc.win?.score)}, compliance ${sc.compliance?.label || sc.compliance?.code || "—"}` : "",
    f.status === "needs_input" ? `- DRAFT, still needs: ${f.missing.join(", ")}` : "",
    ...(f.typed.length ? [``, `## Lines typed in the app (no page source yet)`, ...f.typed.map((t) => `- ${t.label}: ${t.text}`)] : []),
    ...(uploads[selected] && Object.keys(uploads[selected]).length ? [``, `Uploaded photos: ${Object.keys(uploads[selected]).join(", ")} (treated as AI models: AI mark, Severe).`] : []),
    ``,
    signedOff(selected) ? `- Reviewer sign-off: **${signoff[selected].name}** ticked all ${signoff[selected].lines.length} lines against their sources (${new Date().toISOString().slice(0, 16)})` : `- Reviewer sign-off: **not done**`,
    ``,
    `## What the image shows`,
    ...[r.ad.headline, ...String(r.ad.on_image_text || "").split("\n")].filter(Boolean).map((l) => `- ${l}`),
    r.ad.footnote ? `- Footnote: ${r.ad.footnote}` : "",
    ``,
    `Caption (post text): ${r.ad.primary_text || "—"}`,
    ``,
    `## Generated copy and its sources`,
    `| Field | Text | Cited facts |`,
    `|---|---|---|`,
    `| Headline | ${c.headline} | ${cites("headline")} |`,
    `| Subhead | ${c.subhead} | ${cites("subhead")} |`,
    ...c.proof_points.map((p, i) => `| Proof ${i + 1} | ${p} | ${c.citations ? (c.citations.proof_points[i] || []).join(", ") : "edited (uncited)"} |`),
    `| Footnote | ${c.footnote} | ${cites("footnote")} |`,
    `| CTA | ${c.cta} | — |`,
    ``,
    `## Findings`,
    ...(r.findings.length ? r.findings.map((x) => `- **${x.severity.toUpperCase()}** ${x.rule_id} (${x.dimension}) — “${x.span}” — ${x.message} _Fix:_ ${x.fix}${x.note ? ` _(${x.note})_` : ""}`) : ["- none"]),
    ``,
    `## Facts cited`,
    ...sheet.facts.filter((x) => JSON.stringify(c.citations || {}).includes(`"${x.id}"`)).map((x) => `- ${x.id} (${x.section}): ${x.text}`),
    ``,
    `_Pre-screen only. Brand and legal sign-off still required._`,
  ];
  return lines.filter((l) => l !== "").join("\n").replace(/\n(#+ )/g, "\n\n$1");
}

// ---------- score flow ----------
$("#score-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  $("#score-msg").textContent = "Scoring…";
  try {
    let ctxSheet = null;
    if (f.product_url) {
      try {
        ctxSheet = (await api("/api/extract", { url: f.product_url })).sheet;
      } catch (err) {
        $("#score-msg").textContent = `Couldn't read that product page (${err.message}); scoring without it.`;
      }
    }
    const report = await api("/api/score", { ad: { ad_type: f.ad_type, headline: f.headline, primary_text: f.primary_text, on_image_text: f.on_image_text, footnote: f.footnote, cta: f.cta }, sheet: ctxSheet });
    if (!$("#score-msg").textContent.startsWith("Couldn't")) $("#score-msg").textContent = "";
    renderReport(report, $("#score-report"));
  } catch (err) {
    $("#score-msg").innerHTML = `<span class="err">${esc(err.message)}</span>`;
  }
};

$("#image").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#score-msg").textContent = "Reading text off the image, then scoring…";
  const b64 = await new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.readAsDataURL(file);
  });
  try {
    const report = await api("/api/score", { image: b64, mediaType: file.type });
    const t = report.transcript;
    // Put the transcript in the form so the marketer can correct it and re-score.
    const form = $("#score-form");
    form.headline.value = t.headline;
    form.on_image_text.value = t.on_image_text;
    form.footnote.value = t.footnote;
    form.cta.value = t.cta;
    $("#score-msg").innerHTML = `Transcribed from image — check the fields above and re-score if anything was misread.${t.illegible_parts && t.illegible_parts !== "none" ? ` <b>Illegible:</b> ${esc(t.illegible_parts)}` : ""}${t.visual_notes && t.visual_notes !== "none" ? ` <b>Visual:</b> ${esc(t.visual_notes)}` : ""}`;
    renderReport(report, $("#score-report"));
  } catch (err) {
    $("#score-msg").innerHTML = `<span class="err">${esc(err.message)}</span>`;
  }
};

// ---------- score many ads at once: images and/or a CSV / XLSX of copy, each through the same /api/score (bulk.js) ----------
let bulkRows = [], bulkRunning = false, bulkStop = false, bulkOrder = 0;
const BULK_LIMIT = 3, BULK_IMG_MAX = 8 * 1024 * 1024, BULK_ALL_MAX = 400;
const BULK_DIR = { order: "asc", verdict: "desc", alignment: "desc", win: "desc", findings: "desc", name: "asc" };
const sheetCache = new Map(); // product_url -> Promise<sheet | null>

$("#bulk-template").onclick = () => download(new Blob([TEMPLATE_CSV], { type: "text/csv" }), "ad_copy_template.csv");
$("#bulk-files").onchange = (e) => { const files = [...e.target.files]; e.target.value = ""; addBulkFiles(files); };
const drop = $("#bulk-drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addBulkFiles([...e.dataTransfer.files]));

const IMG_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
async function addBulkFiles(files) {
  const notes = [];
  let imgs = 0, copy = 0;
  for (const f of files) {
    const ext = (f.name.toLowerCase().match(/\.(\w+)$/) || [])[1] || "";
    try {
      if (IMG_EXT[ext]) {
        if (f.size > BULK_IMG_MAX) { notes.push(`${f.name}: over 8 MB, skipped (resize it first).`); continue; }
        if (bulkRows.length >= BULK_ALL_MAX) { notes.push(`The list is full (${BULK_ALL_MAX} rows); ${f.name} was skipped.`); continue; }
        bulkRows.push(newBulkRow({ kind: "image", file: f, name: f.name, thumb: URL.createObjectURL(f) })); imgs++;
      } else if (ext === "csv" || ext === "xlsx") {
        const table = ext === "csv" ? parseCsv(await f.text()) : await parseXlsx(await f.arrayBuffer());
        const t = adsFromTable(table);
        notes.push(...t.problems.map((p) => `${f.name}: ${p}`));
        if (t.ignored.length) notes.push(`${f.name}: columns not used: ${t.ignored.join(", ")}.`);
        for (const a of t.ads) {
          if (bulkRows.length >= BULK_ALL_MAX) { notes.push(`The list is full (${BULK_ALL_MAX} rows); the rest of ${f.name} was skipped.`); break; }
          bulkRows.push(newBulkRow({ kind: "copy", ad: a.ad, product_url: a.product_url, name: `${f.name} · row ${a.row}`, headline: a.ad.headline })); copy++;
        }
      } else notes.push(`${f.name}: not an image, CSV or XLSX file, skipped.`);
    } catch (err) { notes.push(`${f.name}: ${err.message}`); }
  }
  $("#bulk-msg").textContent = [`Added ${imgs} image${imgs === 1 ? "" : "s"} and ${copy} copy row${copy === 1 ? "" : "s"}.`, ...notes].join(" ");
  renderBulk();
}
const newBulkRow = (r) => ({ order: ++bulkOrder, status: "queued", verdict: "", verdictLabel: "", alignment: null, win: null, compliance: "", findings: [], findingCount: 0, headline: "", error: "", note: "", report: null, ...r });

const fileB64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = () => rej(new Error("Could not read the file")); fr.readAsDataURL(file); });
const sheetFor = (url) => { if (!sheetCache.has(url)) sheetCache.set(url, api("/api/extract", { url }).then((r) => r.sheet).catch(() => null)); return sheetCache.get(url); };

async function scoreBulkRow(row) {
  row.status = "scoring"; row.error = ""; row.note = "";
  renderBulk();
  try {
    let report;
    if (row.kind === "image") {
      report = await api("/api/score", { image: await fileB64(row.file), mediaType: IMG_EXT[(row.name.toLowerCase().match(/\.(\w+)$/) || [])[1]] || row.file.type });
      row.headline = report.transcript?.headline || report.ad?.headline || "";
    } else {
      const sheet = row.product_url ? await sheetFor(row.product_url) : null;
      if (row.product_url && !sheet) row.note = "The product page could not be read, so it was scored without it.";
      report = await api("/api/score", { ad: row.ad, sheet });
    }
    Object.assign(row, summarise(report), { report, status: "done", headline: row.headline || report.ad?.headline || "" });
  } catch (err) { row.status = "error"; row.error = err.message; }
  renderBulk();
}

async function startBulk() {
  if (bulkRunning) return;
  // Image rows need the key (the model reads the picture's text); without it they are marked, not sent.
  for (const r of bulkRows) if (r.status === "needs_key" && llm) r.status = "queued";
  for (const r of bulkRows) if (r.status === "queued" && r.kind === "image" && !llm) r.status = "needs_key";
  const todo = bulkRows.filter((r) => r.status === "queued" || r.status === "error");
  if (!todo.length) { renderBulk(); return; }
  bulkRunning = true; bulkStop = false;
  todo.forEach((r) => (r.status = "queued"));
  renderBulk();
  await runPool(todo, BULK_LIMIT, scoreBulkRow, () => bulkStop);
  if (bulkStop) bulkRows.forEach((r) => { if (r.status === "scoring") r.status = "queued"; });
  bulkRunning = false;
  renderBulk();
}
$("#bulk-start").onclick = startBulk;
$("#bulk-stop").onclick = () => { bulkStop = true; $("#bulk-stop").disabled = true; };
$("#bulk-clear").onclick = () => {
  if (bulkRunning) return;
  bulkRows.forEach((r) => r.thumb && URL.revokeObjectURL(r.thumb));
  bulkRows = []; $("#bulk-msg").textContent = ""; renderBulk();
};
$("#bulk-csv").onclick = () => download(new Blob([resultsToCsv(bulkRows)], { type: "text/csv" }), "ad-scores.csv");
$("#bulk-filters").onsubmit = (e) => e.preventDefault();
$("#bulk-filters").addEventListener("input", () => renderBulk());
$("#bulk-reset").onclick = () => { $("#bulk-q").value = ""; $("#bulk-verdict").value = ""; $("#bulk-sort").value = "order"; $("#bulk-asc").checked = false; renderBulk(); };

let bulkFrame = 0;
function renderBulk() { cancelAnimationFrame(bulkFrame); bulkFrame = requestAnimationFrame(drawBulk); }
// Called when the API key arrives: image rows that were waiting for it can be scored now.
function updateBulkControls() { if (bulkRows.length) drawBulk(); }
function drawBulk() {
  $("#bulk-run").classList.toggle("hidden", !bulkRows.length);
  if (!bulkRows.length) return;
  const done = bulkRows.filter((r) => r.status === "done" || r.status === "error").length;
  const needKey = bulkRows.filter((r) => r.status === "needs_key" && !llm).length;
  const errors = bulkRows.filter((r) => r.status === "error").length;
  const queued = bulkRows.filter((r) => ["queued", "error"].includes(r.status) || (r.status === "needs_key" && llm)).length;
  $("#bulk-bar").max = Math.max(1, bulkRows.length - needKey);
  $("#bulk-bar").value = done;
  $("#bulk-prog").textContent = `${done} of ${bulkRows.length - needKey} scored${errors ? ` · ${errors} failed` : ""}${needKey ? ` · ${needKey} image row${needKey === 1 ? "" : "s"} need the API key (top right) to read the image text` : ""}${bulkRunning ? " · working…" : ""}`;
  const start = $("#bulk-start");
  start.disabled = bulkRunning || !queued;
  start.textContent = bulkRunning ? "Scoring…" : done && queued ? `Score the remaining ${queued}` : `Score ${bulkRows.length} ad${bulkRows.length === 1 ? "" : "s"}`;
  $("#bulk-stop").classList.toggle("hidden", !bulkRunning);
  $("#bulk-stop").disabled = bulkStop;
  $("#bulk-clear").disabled = bulkRunning;

  const sortKey = $("#bulk-sort").value;
  const dir = (BULK_DIR[sortKey] === "desc") !== $("#bulk-asc").checked ? "desc" : "asc";
  const shown = sortRows(filterRows(bulkRows, { verdict: $("#bulk-verdict").value, q: $("#bulk-q").value }), sortKey, dir);
  $("#bulk-count").textContent = bulkRows.length ? countText(shown.length, bulkRows.length, "row") : "";
  $("#bulk-reset").disabled = !$("#bulk-q").value && !$("#bulk-verdict").value && sortKey === "order" && !$("#bulk-asc").checked;
  const num = (n) => (n == null ? "–" : n);
  $("#bulk-body").innerHTML = shown.map((r) => {
    const v = VERDICT_KEYS.find((x) => x.key === r.verdict);
    const chip = r.status === "done" ? `<span class="chip st-${{ ready: "READY_FOR_REVIEW", fix: "NEEDS_CHANGES", blocked: "BLOCKED", rules: "wait" }[r.verdict] || "wait"}">${esc(v?.label || r.verdictLabel || "–")}</span>` : `<span class="chip ${r.status === "error" || r.status === "needs_key" ? "no" : "st-wait"}">${esc(r.status === "needs_key" ? "Needs the API key" : r.status === "error" ? "Failed" : r.status === "scoring" ? "Scoring…" : "Waiting")}</span>`;
    const name = `${r.thumb ? `<img class="bthumb" src="${esc(r.thumb)}" alt="" />` : ""}<span class="bname"><b>${esc(r.name)}</b>${r.headline ? `<br><span class="hint">${esc(r.headline.slice(0, 90))}</span>` : ""}</span>`;
    const finds = r.status === "done" ? (r.findings.length ? `<ul class="bfind">${r.findings.map((f) => `<li>${esc(f)}</li>`).join("")}${r.findingCount > r.findings.length ? `<li class="hint">+ ${r.findingCount - r.findings.length} more</li>` : ""}</ul>` : '<span class="hint">No findings</span>') + (r.note ? `<p class="hint">${esc(r.note)}</p>` : "") : `<span class="hint">${esc(statusText(r))}</span>`;
    return `<tr data-id="${r.order}" class="brow"><td>${r.order}</td><td><div class="bad">${name}</div></td><td>${chip}</td><td>${r.status === "done" ? num(r.alignment) : "–"}</td><td>${r.status === "done" ? num(r.win) : "–"}</td><td>${r.status === "done" ? esc(r.compliance) : "–"}</td><td>${finds}</td><td><button type="button" class="ghost bopen" data-id="${r.order}" ${r.status === "done" ? "" : "disabled"} aria-label="Open the full report for ${esc(r.name)}">Open</button></td></tr>`;
  }).join("") || `<tr><td colspan="8" class="hint empty-note">No rows match these filters.</td></tr>`;
}
$("#bulk-body").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  const row = tr && bulkRows.find((r) => r.order === Number(tr.dataset.id));
  if (row?.status === "done") openBulkReport(row);
});
function openBulkReport(row) {
  $("#viewer-body").innerHTML = `<h3>${esc(row.name)}</h3>${row.thumb ? `<p><img class="bpreview" src="${esc(row.thumb)}" alt="${esc(row.name)}" /></p>` : ""}${row.note ? `<p class="hint">${esc(row.note)}</p>` : ""}<div id="bulk-report"></div>`;
  renderReport(row.report, $("#bulk-report"));
  $("#viewer").showModal();
}

// ---------- open straight to a shared view (#...): the tab, the existing-ads filters and the image filters ----------
async function applyHash() {
  const p = parseHash(location.hash);
  imgState = p.images;
  if (p.lib === "all") await openLibrary("all", { state: p.ads });
  else if (p.lib === "p") {
    $("#url").value = `https://beminimalist.co/products/${p.h}`;
    await openLibrary("p", { h: p.h, state: p.ads });
  }
  if (p.tab !== currentTab) showTab(p.tab);
  else if (p.tab === "images") initImageLibrary();
}
window.addEventListener("hashchange", applyHash);
if (location.hash) applyHash();

// A product link in the address (?url=…, e.g. from the ad library page's "Make ads for a product" box) opens that product.
{ const u = new URLSearchParams(location.search).get("url"); if (u && !location.hash) { $("#url").value = u; $("#extract-form").requestSubmit(); } }
