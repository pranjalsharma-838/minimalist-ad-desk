// The app's formats (user, 2026-10-05: "when ads are rendered for a product I don't see all the formats, many are not even
// clickable"). One entry per renderer layout the app can fill, each tied to the templates of the same 48-format catalog
// (config/templates.json) and ranked by the same archetype scoring the library uses (lib/archetype.js).
//
// Every format is built as a library-shaped BRIEF and drawn / scored through lib/brief_check.js specFromBrief +
// adFromBrief and public/render.js LAYOUTS, exactly like pipeline/08_compose.js, so the app and the library can't drift.
//
// Three outcomes per format:
//  - ready        every line comes from the product page, the captured offers / prices / reviews, or the cited copy;
//  - needs input  the format fits, but a line or a photo is missing. It still opens: the draft shows [placeholders] and
//                 says exactly what to supply (typed lines, an AI draft with citations when a key is set, a real photo);
//  - not shown    the product can't fill it honestly (no study number, no review, no FAQ ...): listed with the reason.
// Nothing is invented: placeholders are never scored, typed lines are flagged as unsourced, people / skin photos carry
// the AI mark and Severe risk exactly like the library (08_compose.js, lib/risk.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankArchetypes } from "./archetype.js";
import { specFromBrief, adFromBrief, checkBrief } from "./brief_check.js";
import { goodReviews } from "./reviews.js";
import { LABEL, worst, SOURCE_RISK } from "./risk.js";
import { wrap, measure, layoutProblems } from "../public/render.js";
import { handleOf, sitewideOffers, pricesOf } from "./live_facts.js";
import { requestState, studioAvailable, passedRender } from "./library.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(path.join(root, p), "utf8")); } catch { return d; } };
const ACCENT = readJson("brand_packs/minimalist/assets/accent_colours.json", {});
const TOP = readJson("brand_packs/minimalist/raw/top20.json", []);
const WEBSITE = readJson("brand_packs/minimalist/raw/website.json", { products: [] }).products || [];

// The asset index changes while the app runs (verified AI renders are being added), so it is re-read when it changes.
let assetCache = { mtime: 0, assets: [] };
export function assets() {
  const f = path.join(root, "brand_packs/minimalist/assets/index.json");
  try {
    const m = fs.statSync(f).mtimeMs;
    if (m !== assetCache.mtime) assetCache = { mtime: m, assets: JSON.parse(fs.readFileSync(f, "utf8")).assets || [] };
  } catch { /* keep the last good copy */ }
  return assetCache.assets;
}
const exists = (rel) => Boolean(rel) && fs.existsSync(path.join(root, rel));

// The product visual, from disk when the asset library has one (user, 2026-10-05: "pick if the asset for that product
// exists, like the cutout, to cut user query time"), in this order: the cut-out of a verified AI master render of the
// real pack (asset index "preferred": true + "cutout"); else any clean cut-out (same rule as 08_compose.js); else the
// accepted master render itself (assets/ai_renders/<handle>/verification.json, approved); else the page photo.
// Returns { file (local, relative) | url (page image), cutout, source }.
export function packVisual(handle, sheet) {
  if (handle) {
    // User review 2026-10-05: the cut of the white-background render left a ragged base, so the verified render is
    // used whole (clean studio shot on white, its own shadow). Photo-backed layouts still use the real cut-out below.
    const pref = assets().find((a) => a.product_handle === handle && a.preferred && exists(a.file));
    // The whitened copy (scripts/whiten_renders.py) so the render's off-white backdrop shows no box on the white canvas.
    if (pref) { const white = pref.file.replace(/\.png$/, "_white.png"); return { file: exists(white) ? white : pref.file, cutout: false, source: "verified master render" }; }
    const cut = assets().find((a) => a.product_handle === handle && a.cutout && exists(a.cutout) && !/unusable/i.test(`${a.cutout_status || ""} ${a.notes || ""}`));
    if (cut) return { file: cut.cutout, cutout: true, source: "brand pack shot (cut-out)" };
    // A label-checked render this app made earlier for the product (same ChatGPT loop as the library renders).
    const made = passedRender(handle);
    if (made) return { url: `/api/request-image?id=${encodeURIComponent(made)}`, cutout: false, source: "label-checked studio render" };
    const ver = readJson(`brand_packs/minimalist/assets/ai_renders/${handle}/verification.json`, null);
    if (ver?.accepted && /approved/i.test(ver.status || "") && exists(`brand_packs/minimalist/assets/ai_renders/${handle}/${ver.accepted}`)) return { file: `brand_packs/minimalist/assets/ai_renders/${handle}/${ver.accepted}`, cutout: false, source: "verified master render" };
  }
  const url = sheet?.images?.[0] || "";
  return url ? { url, cutout: false, source: "product page photo" } : null;
}
// Where the browser loads it from (same origin, so PNG export works).
export const visualSrc = (handle, v) => (!v ? "" : v.file ? `/api/pack?handle=${encodeURIComponent(handle)}` : v.url);

// A real texture / close-up photo in the asset library (never generated).
export const textureOf = (sheet) => assets().find((a) => ["texture", "macro"].includes(a.type) && a.product_handle === handleOf(sheet) && exists(a.file)) || null;

// ---------- AI images already made for a product (user, 2026-10-05: ads made in the app use our AI images, no uploads) ----------
// Reused, never regenerated, and never asked for as an upload while one exists:
//  - the APPROVED ChatGPT texture shot (assets/ai_renders/<handle>/texture_verification.json): the pack's label was checked
//    word for word and only the swatch is AI, so it is Low risk (rules/brand_decisions.json DEC-04) and keeps the small
//    AI-generated - illustrative mark; drawn as a "textureScene" exactly like pipeline/08_compose.js;
//  - people / frames the library pipeline made (pipeline/runs/*/backgrounds/<handle>__t<N>.person.png, .frame<K>.png, N = the
//    catalog template the image was made for): AI mark + Severe risk, like the library.
// The browser loads them through /img/<path> (lib/images.js serves exactly these folders), so PNG export works.
const SAFE_HANDLE = /^[a-z0-9-]+$/i;
const imgUrl = (rel) => `/img/${rel.split("/").map(encodeURIComponent).join("/")}`;
const readJsonBom = (rel, d) => { try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8").replace(/^﻿/, "")); } catch { return d; } };

// The approved texture shot (relative path), or null.
export function textureScene(handle) {
  if (!SAFE_HANDLE.test(handle || "")) return null;
  const dir = `brand_packs/minimalist/assets/ai_renders/${handle}`;
  const tv = readJsonBom(`${dir}/texture_verification.json`, null);
  return tv?.status === "approved" && tv.accepted && exists(`${dir}/${tv.accepted}`) ? `${dir}/${tv.accepted}` : null;
}

// pipeline/runs/*/backgrounds: per handle, the person image per template and the frame set per template. Newest run wins; a
// frame set always comes from one run. Re-read every few seconds (new runs appear while the app is open).
let aiCache = { t: 0, by: new Map() };
function aiScan() {
  if (Date.now() - aiCache.t < 4000) return aiCache.by;
  const by = new Map();
  let runs = [];
  try { runs = fs.readdirSync(path.join(root, "pipeline/runs"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse(); } catch { /* no runs yet */ }
  for (const run of runs) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, "pipeline/runs", run, "backgrounds")); } catch { continue; }
    for (const f of files) {
      const m = f.match(/^([a-z0-9-]+?)__t(\d+)\.(person|frame(\d+))\.(png|jpe?g|webp)$/i);
      if (!m) continue;
      const [, h, t, kind, k] = m, rel = `pipeline/runs/${run}/backgrounds/${f}`;
      const e = by.get(h) || by.set(h, { person: {}, frames: {} }).get(h);
      if (kind === "person") e.person[t] ||= { rel, run };
      else {
        const set = (e.frames[t] ||= { run, files: {} });
        if (set.run === run) set.files[k] = rel;
      }
    }
  }
  aiCache = { t: Date.now(), by };
  return by;
}
// The first person image found for the product, trying the catalog templates in this order: { rel, run, tpl } or null.
export function aiPerson(handle, order, variant = 0) {
  const e = aiScan().get(handle);
  // Every person image for the product, in template order; a build variant rotates through them (variant 0 / 1 = the first).
  const all = order.filter((t) => e?.person[t]).map((t) => ({ ...e.person[t], tpl: t }));
  return all.length ? all[Math.max(0, variant - 1) % all.length] : null;
}
// The AI frames made for one template, in order 1..n (at least `min` of them, in unbroken order): { rels, run, tpl } or null.
export function aiFrames(handle, tpl, min = 2) {
  const set = aiScan().get(handle)?.frames[tpl];
  if (!set) return null;
  const rels = [];
  for (let k = 1; set.files[k]; k++) rels.push(set.files[k]);
  return rels.length >= min ? { rels, run: set.run, tpl } : null;
}
const PERSON_ORDER = [8, 9, 7, 6, 10, 41, 11, 31, 30]; // in-use, application, in-hand, lifestyle, problem macro ...
const CREATOR_ORDER = [31, 30, 8, 9, 6, 7, 10, 41, 11]; // selfie first
const aiNote = (what, x) => `${what} reused from the library (run ${x.run}, ${x.rel.split("/").pop()}): drawn with the AI-GENERATED mark and Severe risk, like the library. Upload your own photo below to replace it.`;

// ---------- page-fact pickers (unchanged rules from the 2026-10-04 app) ----------
const NOT_CITABLE = new Set(["testimonial", "faq", "inci"]);
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const isLabelLine = (t) => /^[^:]{2,30}:\s/.test(t);
const nameFact = (sheet) => sheet.facts.find((f) => f.kind === "name")?.id || sheet.facts[0]?.id;
export const lockedActives = (sheet) => (sheet.actives || []).filter((a) => a.pct).slice(0, 3);
// Badges are proof points short enough for a pill (≤ 6 words); page label lines read as specs, never badges.
export const badgesOf = (copy) => (copy.proof_points || []).filter((p) => words(p) <= 6 && p.length <= 44 && !isLabelLine(p)).slice(0, 2);
export function pickStat(sheet) {
  for (const f of sheet.facts) {
    if (f.kind !== "study") continue;
    const m = f.text.match(/^(\d{1,3}(?:\.\d+)?%)\s+(.{8,110})$/);
    if (m) return { value: m[1], label: m[2].replace(/\.$/, ""), id: f.id, section: f.section };
  }
  return null;
}
const fitsCard = (q) => wrap(`“${q}”`, Math.round(32 * 0.7), 440, 0.52).length <= 6;
const cardFits = (sheet, quote, stars, source) => fitsCard(quote) && measure({ layout: "review", headline: sheet.title, review: { stars, quote, source }, footnote: "Results vary: one customer's experience.", cta: "Shop now" }).fits;
export function pickQuote(sheet) {
  const rv = goodReviews(handleOf(sheet));
  const r = rv.reviews.find((x) => cardFits(sheet, x.text.trim(), x.stars, `${x.name}, verified buyer, ${x.stars}★, ${x.date} (beminimalist.co, captured ${rv.day})`));
  if (r) return { quote: r.text.trim(), name: r.name, stars: r.stars, date: r.date, id: `REV:${r.name}:${r.date}`, verified: true, day: rv.day };
  for (const f of sheet.facts) {
    if (f.kind !== "testimonial") continue;
    const sig = f.text.trim().match(/^([\s\S]*?)["”]?\s+[-–—]\s*([A-Z][a-z]+(?:\s[A-Z]\.?)?)\.?["”]?\s*$/);
    const quote = (sig ? sig[1] : f.text).trim().replace(/^["“]\s*/, "").replace(/["”]\s*$/, "").trim();
    if (quote && cardFits(sheet, quote, 0, "customer quote on the product page")) return { quote, name: sig ? sig[2] : "", id: f.id };
  }
  return null;
}
const strengthOf = (a) => (a.name === "SPF" ? `SPF ${a.pct.replace(/%$/, "")}` : `${a.pct} ${a.name}`);
export const questionOf = (sheet) => { const a = lockedActives(sheet)[0]; return a ? `What does ${strengthOf(a)} do?` : ""; };

// "Label: value" page lines (Skin type, Concerns, Suitable for, When to use ...), verbatim.
const labelRows = (sheet, max = 70) => sheet.facts.filter((f) => ["suitability", "usage"].includes(f.kind)).map((f) => ({ m: f.text.match(/^([^:]{2,30}):\s*(.+)$/), f })).filter((x) => x.m && x.m[2].length <= max).map(({ m, f }) => ({ label: m[1].trim(), value: m[2].trim(), cites: [f.id] }));
// Short brand-written claims, word for word (no cutting: a cut sentence can change its meaning).
const shortClaims = (sheet, max) => sheet.facts.filter((f) => f.kind === "claim" && f.text.length <= max && !isLabelLine(f.text));

// Product category (routine slot, range siblings): the top-20 list, else the product name.
const CAT_WORD = { cleanser: "cleanser", serum: "serum", moisturizer: "moisturiser", sunscreen: "sunscreen", toner: "toner", exfoliant: "exfoliant", eye: "eye cream", hair: "hair serum" };
export function categoryOf(handle, title = "") {
  const t = TOP.find((x) => x.handle === handle);
  if (t) return t.format;
  const s = String(title).toLowerCase();
  return /hair/.test(s) ? "hair" : /cleanser|face wash|body wash/.test(s) ? "cleanser" : /spf|sunscreen/.test(s) ? "sunscreen" : /toner/.test(s) ? "toner" : /eye/.test(s) ? "eye" : /moisturi[sz]er|cream/.test(s) ? "moisturizer" : /serum/.test(s) ? "serum" : "";
}
// Another of our products, from the captured website pages (read-only), with its pack visual.
function companion(h) {
  const p = WEBSITE.find((x) => x.handle === h);
  if (!p) return null;
  return { url: p.url, title: p.title, actives: p.actives || [], facts: p.facts || [], images: [] };
}
// A short label for a product in a range: its own tagline (≤ 40 characters), else its "Concerns:" / "Skin type:" line.
function shortLabel(sh) {
  const tag = sh.facts.find((f) => f.kind === "claim" && /tagline/i.test(f.section) && f.text.length <= 40);
  if (tag) return { label: tag.text, id: tag.id };
  const row = labelRows(sh, 40).find((r) => /concern|skin type/i.test(r.label));
  return row ? { label: `${row.label}: ${row.value}`.length <= 40 ? `${row.label}: ${row.value}` : row.value, id: row.cites[0] } : null;
}

// ---------- the formats ----------
// templates: catalog ids this app format draws (the best-ranked one names it). person: a people photo is part of it.
export const FORMATS = [
  { id: "hero", label: "Product hero", layout: "hero", templates: [1, 5, 34, 4, 6, 40, 42, 43, 48] },
  { id: "badges", label: "Benefit badges", layout: "badges", templates: [2], ai: true },
  { id: "actives", label: "Ingredient focus", layout: "actives", templates: [3, 23] },
  { id: "stat", label: "Study result", layout: "stat", templates: [25] },
  { id: "review", label: "Customer quote", layout: "review", templates: [26] },
  { id: "question", label: "Question and answer", layout: "question", templates: [35] },
  { id: "texture", label: "Texture or close-up photo", layout: "texture", templates: [21, 20] },
  { id: "offer", label: "Offer", layout: "offer", templates: [36] },
  { id: "pricecompare", label: "Price", layout: "pricecompare", templates: [37] },
  { id: "range", label: "Range or bundle", layout: "range", templates: [38, 39, 46] },
  { id: "journey", label: "Routine steps", layout: "journey", templates: [22] },
  { id: "spec", label: "Spec sheet", layout: "spec", templates: [24] },
  { id: "callouts", label: "Callouts", layout: "callouts", templates: [15], ai: true },
  { id: "socialproof", label: "Star rating", layout: "socialproof", templates: [28] },
  { id: "faq", label: "FAQ", layout: "faq", templates: [32], ai: true },
  { id: "native", label: "Native post", layout: "native", templates: [33] },
  { id: "thisvsthat", label: "This vs that", layout: "thisvsthat", templates: [19], ai: true },
  { id: "oldnew", label: "Old way / new way", layout: "oldnew", templates: [18], ai: true },
  { id: "usvsthem", label: "Us vs them", layout: "usvsthem", templates: [17], ai: true },
  { id: "person", label: "With a person", layout: "hero", templates: [7, 8, 9, 41, 11, 6, 10], person: true },
  { id: "creator", label: "Creator post", layout: "native", templates: [30, 31], person: true },
  { id: "weeks", label: "Week-by-week journey", layout: "spec", templates: [22] },
  { id: "in_hand", label: "Product in hand", layout: "texture", templates: [8, 41], person: true },
  { id: "before_after", label: "Before / after", layout: "before_after", templates: [12], person: true },
  { id: "timeline", label: "Progress timeline", layout: "timeline", templates: [14], person: true },
];
// Catalog formats the app doesn't draw, and why (the library pipeline covers some of them).
export const NOT_IN_APP = [
  { templates: [13, 16], why: "need AI-made skin or result frames (library pipeline only, Severe)" },
  { templates: [27, 29, 44, 47], why: "no layout built yet (a designer works from the library brief)" },
  { templates: [45], why: "needs a real unboxing photo without printed copy" },
];

const P = (s) => `[${s}]`;
const isPh = (s) => typeof s === "string" && /^\[[^\]]*\]$/.test(s.trim());
// Placeholders are drawn so the slot is visible, but never scored.
function stripPlaceholders(v) {
  if (typeof v === "string") return isPh(v) ? "" : v;
  if (Array.isArray(v)) return v.map(stripPlaceholders).filter((x) => !(x === "" || (x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((y) => y === "" || y == null || Array.isArray(y)))));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripPlaceholders(x)]));
  return v;
}

// A line the user typed, or an AI-drafted line whose citations still check out against the page.
function citesOk(text, cites, sheet) {
  if (!cites?.length) return false;
  const h = "_main";
  return checkBrief({ layout: "hero", headline: text, citations: { headline: cites } }, { [h]: sheet }, h).length === 0;
}

function base(copy, layout, keepSub) {
  return {
    layout, headline: copy.headline, subhead: keepSub ? copy.subhead : "", caption: keepSub ? "" : copy.subhead,
    proof_points: copy.proof_points || [], footnote: copy.footnote, cta: copy.cta, citations: copy.citations || {},
  };
}
const cap = (...xs) => xs.filter(Boolean).join(" ");

// Each builder returns { brief, sheets?, fields?, photos?, missing[], notes[], notFit? }.
// ctx: { copy, sheet, h, v (typed / drafted values), c (their citations), photos (flags), field(key, auto, label, extra) }
const BUILD = {
  hero: ({ copy }) => ({ brief: base(copy, "hero", true) }),
  native: ({ copy }) => ({ brief: base(copy, "native", true) }),
  // A person image: the product's own AI image from the library when there is one (no upload needed); an uploaded photo replaces it.
  person: ({ copy, photos, h, variant, fresh }) => {
    const ai = photos.person || fresh ? null : aiPerson(h, PERSON_ORDER, variant);
    const have = Boolean(photos.person || ai || fresh);
    return {
      brief: { ...base(copy, "hero", true), ai_label_required: have }, personAi: ai,
      photos: [{ key: "person", label: ai ? "Optional: your own photo of a person, instead of the AI image (the product itself is composited, never drawn)" : "Photo of a person with the product (the product itself is composited, never drawn)" }],
      missing: have ? [] : ["a photo of a person (none in the library for this product; upload it below)"], notes: ai ? [aiNote("AI person image", ai)] : [],
    };
  },
  creator: ({ copy, photos, h, variant, fresh }) => {
    const ai = photos.person || fresh ? null : aiPerson(h, CREATOR_ORDER, variant);
    const have = Boolean(photos.person || ai || fresh);
    return {
      brief: { ...base(copy, "native", true), ai_label_required: have }, personAi: ai,
      photos: [{ key: "person", label: ai ? "Optional: your own creator photo, instead of the AI image (portrait, no product in it)" : "Creator photo (portrait, no product in it)" }],
      missing: have ? [] : ["a creator photo (none in the library for this product; upload it below)"], notes: ai ? [aiNote("AI creator-style image", ai)] : [],
    };
  },
  before_after: ({ copy, photos, h, fresh, sheet }) => {
    if (noResultImages(sheet)) return { notFit: "baby product: no before / after images of infants" };
    const own = Boolean(photos.before && photos.after);
    const ai = own || fresh ? null : aiFrames(h, 12, 2);
    return {
      brief: { ...base(copy, "before_after", false), ai_label_required: own || fresh || Boolean(ai) }, framesAi: ai && { ...ai, rels: ai.rels.slice(0, 2) }, photosOk: own || fresh || Boolean(ai),
      photos: [{ key: "before", label: ai ? "Optional: your own before photo (real, unretouched study photo), instead of the AI frame" : "Before photo (real, unretouched study photo)" }, { key: "after", label: ai ? "Optional: your own after photo, instead of the AI frame" : "After photo (same person, light and angle)" }],
      missing: own || ai || fresh ? [] : [photos.before ? "" : "the before photo", photos.after ? "" : "the after photo"].filter(Boolean),
      notes: ai ? [aiNote("AI before / after frames", { ...ai, rel: ai.rels[0] })] : [],
    };
  },
  // Progress timeline (#14): the AI frames the library made for this product, with the real pack placed in every frame by code.
  // Day / week labels mark routine stages, not study timings (as in the library brief).
  timeline: ({ copy, sheet, fresh }) => {
    if (noResultImages(sheet)) return { notFit: "baby product: no progress images of infants" };
    const ai = fresh ? { rels: [1, 2, 3, 4], run: "", tpl: 14 } : aiFrames(handleOf(sheet), 14, 2);
    if (!ai) return { notFit: "no AI progress frames have been made for this product yet (the library pipeline makes them)" };
    const a = lockedActives(sheet)[0];
    const headline = a ? `${strengthOf(a)} in a daily routine` : "";
    if (!headline || headline.length > 60) return { notFit: "the product name has no active with its strength to build the line from" };
    const labels = ["Day 1", "Week 2", "Week 4", "Week 8"];
    const rels = ai.rels.slice(0, 4);
    return {
      brief: {
        layout: "timeline", headline, subhead: "", proof_points: [], citations: { headline: [nameFact(sheet)] }, cta: copy.cta,
        footnote: "Day and week labels mark routine stages, not study timings. AI illustrations, not real results.",
        caption: cap(copy.subhead, "The frames are AI illustrations of a routine, not study results."),
        frames: rels.map((_, i) => ({ label: labels[i] })), pack_in_frames: true, ai_label_required: true,
      },
      framesAi: fresh ? null : { ...ai, rels },
      notes: fresh ? [] : [aiNote("AI progress frames", { ...ai, rel: rels[0] })],
    };
  },

  badges: ({ copy, field, sheet }) => {
    const auto = badgesOf(copy);
    const cit = (t) => { const i = (copy.proof_points || []).indexOf(t); return i >= 0 ? (copy.citations?.proof_points || [])[i] : null; };
    const b = [field("b1", auto[0], "Badge 1 (up to 6 words)", { max: 44, cites: cit(auto[0]) }), field("b2", auto[1], "Badge 2 (optional)", { max: 44, cites: cit(auto[1]) })];
    const got = b.filter((x) => x.text);
    return { brief: { ...base(copy, "badges", false), badges: got.length ? got.map((x) => ({ text: x.text, cites: x.cites })) : [{ text: P("Badge: up to 6 words from the page") }] }, missing: got.length ? [] : ["at least one short badge line"] };
  },

  actives: ({ copy, sheet }) => {
    const nid = nameFact(sheet);
    const list = lockedActives(sheet).map((a) => ({ pct: a.pct, name: a.name, line: "", cites: [nid] }));
    for (const f of sheet.facts.filter((x) => x.kind === "ingredient_note")) {
      if (list.length >= 2) break;
      const n = f.section.trim();
      if (n.length <= 28 && !list.some((a) => a.name.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(a.name.toLowerCase()))) list.push({ pct: "", name: n, line: "", cites: [f.id] });
    }
    if (!list.length) return { notFit: "the page names no active ingredient" };
    return { brief: { ...base(copy, "actives", false), actives: list } };
  },

  stat: ({ copy, sheet }) => {
    const st = pickStat(sheet);
    if (!st) return { notFit: "the page has no consumer-study percentage" };
    return { brief: { ...base(copy, "stat", false), stat: { value: st.value, label: st.label, cites: [st.id] }, footnote: "Consumer study result as published on the product page.", caption: cap(copy.subhead, copy.footnote) } };
  },

  review: ({ copy, sheet }) => {
    const q = pickQuote(sheet);
    if (!q) return { notFit: "no verified review or page quote short enough to show in full (a quote is never shortened)" };
    const source = q.verified ? `${q.name}, verified buyer, ${q.stars}★, ${q.date} (beminimalist.co, captured ${q.day})` : `${q.name ? `${q.name}, ` : ""}customer quote on the product page`;
    return { brief: { layout: "review", headline: sheet.title, review: { stars: q.verified ? q.stars : 0, quote: q.quote, source }, footnote: "Results vary: one customer's experience.", caption: cap(copy.headline, copy.subhead, copy.footnote), proof_points: copy.proof_points || [], cta: copy.cta, citations: {} } };
  },

  question: ({ copy, sheet }) => {
    const q = questionOf(sheet);
    if (!q) return { notFit: "no active with its strength in the product name to ask about" };
    return { brief: { ...base(copy, "question", false), headline: q, question: q, answer: copy.headline, question_cites: [nameFact(sheet), ...(copy.citations?.headline || [])] } };
  },

  texture: ({ copy, sheet, photos, h, fresh }) => {
    // The approved ChatGPT texture shot first (pack unchanged, label checked word for word, only the swatch is AI: DEC-04);
    // else a real texture photo from the asset library; else an upload.
    // Approved texture shots of the 21 library products are reused even on a fresh build (user, 2026-10-05: "texture shots
    // for the old 21 are approved"); only a product without one gets a new ChatGPT texture.
    const scene = textureScene(h);
    if (scene || (fresh && !textureOf(sheet) && !photos.texture)) {
      return {
        brief: { ...base(copy, "texture", false), tag: "Skin Science", footnote: "Texture shown is an AI illustration.", caption: cap(copy.subhead, copy.footnote), ai_label_required: true, citations: { ...(copy.citations || {}), footnote: [] } },
        textureSceneRel: scene || undefined,
        notes: !scene ? [] : [`Texture shot: ${scene.split("/").pop()}, a ChatGPT image of this product's pack with its texture, label checked word for word (approved). Shown with the small AI-generated - illustrative mark.`],
      };
    }
    const lib = textureOf(sheet);
    return {
      brief: base(copy, "texture", false), textureSrc: lib ? `/api/texture?handle=${encodeURIComponent(handleOf(sheet))}` : "",
      photos: lib ? [] : [{ key: "texture", label: "Real photo of this product's texture or a close-up (never AI-made)" }],
      missing: lib || photos.texture ? [] : ["a real texture or close-up photo (none in the asset library for this product; upload one below)"],
      notes: lib ? [`Texture photo from the asset library: ${lib.file.split("/").pop()}.`] : [],
    };
  },

  offer: ({ copy, field, v, sheet }) => {
    // Captured offers belong to beminimalist.co only; another brand gets only the offers on its own live page.
    const other = sheet.brand_site === "other", site = other ? sheet.host : "beminimalist.co";
    const offers = other ? sheet.facts.filter((f) => f.kind === "offer").map((f) => ({ id: f.id, text: f.line, type: "", terms: "", expiry: "", day: f.day })) : sitewideOffers();
    if (other && !offers.length) return { notFit: "no offer is shown on this product's own page" };
    const def = offers.find((o) => o.type === "bogo") || offers.find((o) => o.type === "free_gift") || offers[0];
    const chosen = offers.find((o) => o.id === v.offer_id) || def;
    const own = v.offer_id === "own";
    const line = field("line", own ? "" : chosen?.text, "Offer line (exactly as on the site)", { max: 60, cites: own ? null : chosen && [chosen.id] });
    const cond = field("condition", own ? "" : chosen && "T&C apply.", "Condition shown beside the offer (needed for 'free' / discounts)", { max: 120, cites: own ? null : chosen && [chosen.id] });
    const valid = field("valid_till", own ? "" : chosen?.expiry || "", "Valid till (only if the site states an end date)", { max: 30, cites: own ? null : chosen && [chosen.id] });
    const fields = [{ key: "offer_id", label: "Offer", value: own ? "own" : chosen?.id || "own", options: [...offers.map((o) => ({ value: o.id, label: `${o.text} (captured ${o.day})` })), { value: "own", label: "Type my own offer" }] }];
    const missing = [line.text ? "" : "the offer line", cond.text ? "" : "the offer's condition"].filter(Boolean);
    // The condition carries "T&C apply." on the creative; the capture date goes with the caption (leanBrief).
    const foot = own ? "" : `Offer as on ${site}, captured ${chosen?.day}; ${chosen?.expiry ? chosen.expiry : "no end date shown"}.`;
    return {
      brief: { ...base(copy, "offer", false), offer: { line: line.text || P("Offer, exactly as on the site"), condition: cond.text || P("Condition"), valid_till: valid.text, cites: line.cites || [] }, footnote: foot, caption: cap(copy.subhead, copy.footnote) },
      fieldsBefore: fields, missing,
      notes: own ? ["Typed offers must match the live site; attach the terms page."] : [`Captured on ${chosen?.day} from the ${site} page (terms: ${chosen?.terms || "site"}). Check it's still live before use.`],
    };
  },

  pricecompare: ({ copy, h }) => {
    const p = pricesOf(h).find((x) => x.mrp && x.mrp > x.price);
    if (!p) return { notFit: "no captured website price below the MRP for this product" };
    const rs = (n) => `₹${n}`;
    return {
      brief: { ...base(copy, "pricecompare", false), prices: [{ label: `MRP, ${p.name}`, value: rs(p.mrp), note: "" }, { label: `On beminimalist.co, ${p.name}`, value: rs(p.price), note: `${p.pct_off_computed}% below MRP · captured ${p.day}` }], caption: cap(copy.subhead, copy.footnote), footnote: `Prices as shown on beminimalist.co on ${p.day}; they may have changed. T&C apply.` },
      notes: [`Prices captured on ${p.day} (${p.id}). Check them on the live page before use.`],
    };
  },

  range: ({ copy, sheet, h }) => {
    const cat = categoryOf(h, sheet.title);
    const sibs = TOP.filter((t) => t.format === cat && t.handle !== h).map((t) => t.handle).filter((x) => companion(x) && packVisual(x)).slice(0, 2);
    if (!cat || !sibs.length) return { notFit: "no other products in this category on file" };
    const sheets = { _main: sheet };
    const items = [];
    const main = shortLabel(sheet);
    if (main) items.push({ product_handle: "_main", handle: h, label: main.label, cites: [main.id] });
    for (const s of sibs) { const c = companion(s), l = shortLabel(c); if (!l) continue; sheets[s] = c; items.push({ product_handle: s, handle: s, label: l.label, cites: [`${s}:${l.id}`] }); }
    if (items.length < 2) return { notFit: "no short page line to label the products with" };
    return { brief: { layout: "range", headline: `Find your ${CAT_WORD[cat] || cat}`, range: items, caption: cap(copy.headline, copy.subhead, copy.footnote), proof_points: copy.proof_points || [], footnote: "", cta: copy.cta, citations: {} }, sheets };
  },

  journey: ({ copy, sheet, h }) => {
    const cat = categoryOf(h, sheet.title);
    if (!cat || cat === "hair") return { notFit: "not part of the face routine on file" };
    const pmOnly = sheet.facts.some((f) => f.kind === "usage" && /when to use:\s*PM\b/i.test(f.text)) && !sheet.facts.some((f) => f.kind === "usage" && /\bAM\b/.test(f.text));
    // The same three products as the library's routine ads (00_product_run.js COMPANIONS); a night-only product ends
    // with a moisturiser instead of sunscreen.
    const CL = "salicylic-lha-2-cleanser", SER = "niacinamide-10-with-matmarine", SPF = "multi-vitamin-spf-50", MOI = "vitamin-b5-10-moisturizer";
    const slots = cat === "cleanser" ? [h, SER, SPF] : cat === "sunscreen" ? [CL, SER, h] : [CL, h, pmOnly && cat !== "moisturizer" ? MOI : SPF];
    const sheets = { _main: sheet };
    const steps = [];
    for (const s of slots) {
      const isMain = s === h, sh = isMain ? sheet : companion(s);
      if (!sh) continue;
      const key = isMain ? "_main" : s;
      sheets[key] = sh;
      const c = categoryOf(isMain ? h : s, sh.title);
      // Each step is its pack, the step word and its active (no line: on the minimal look a step line goes to the caption,
      // and a companion product's tagline there would be a claim this ad never set out to make).
      const nf = nameFact(sh);
      steps.push({ label: `Step ${steps.length + 1} · ${(CAT_WORD[c] || c).replace(/^./, (x) => x.toUpperCase())}`, product_handle: key, handle: isMain ? h : s, cat: CAT_WORD[c] || c, line: "", cites: nf ? [isMain ? nf : `${s}:${nf}`] : [] });
    }
    if (steps.length < 2) return { notFit: "the routine products aren't on file" };
    const cats = steps.map((s) => s.cat);
    const head = `${cats.slice(0, -1).join(", ")}, then ${cats[cats.length - 1]}`.replace(/^./, (x) => x.toUpperCase());
    const when = sheet.facts.find((f) => f.kind === "usage" && /when to use/i.test(f.text));
    return {
      brief: { layout: "journey", headline: head, steps: steps.map(({ cat: _c, handle: _h, ...s }) => s), caption: cap(copy.headline, copy.subhead, when?.text, copy.footnote), proof_points: copy.proof_points || [], footnote: "", cta: copy.cta, citations: {} },
      sheets, stepHandles: steps.map((s) => s.handle),
      notes: pmOnly ? ["This product is for night use (page: \"When to use: PM\"), so the routine ends with a moisturiser, not sunscreen."] : [],
    };
  },

  // Week-by-week journey (user, 2026-10-05: "journey could be 4 week to 12 week long basis the product"). Its length is
  // the longest study period the page states, between 4 and 12 weeks (4 when the page states none). Rows are routine
  // stages from the page's own usage line; the last row is the page's study result only when one is stated for that week.
  weeks: ({ copy, sheet }) => {
    const facts = sheet.facts || [];
    const periods = facts.flatMap((f) => [...String(f.text).matchAll(/\b(\d{1,2})\s*weeks?\b/gi)].map((m) => ({ n: Number(m[1]), f }))).filter((x) => x.n >= 4 && x.n <= 12);
    const top = periods.sort((a, b) => b.n - a.n)[0], N = top?.n || 4, mid = Math.max(2, Math.round(N / 2));
    const use = facts.find((f) => /\b(apply|use|massage|take|roll|spread|lather)\b/i.test(f.text) && f.text.length <= 90);
    const short = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);
    const rows = [
      { label: "Week 1", value: use ? short(use.text, 70) : "Start as directed on the pack", cites: use ? [use.id] : [] },
      { label: `Week ${mid}`, value: "Keep the same routine, every day", cites: [] },
      { label: `Week ${N}`, value: top ? short(top.f.text, 70) : "Keep going, as directed on the pack", cites: top ? [top.f.id] : [] },
    ];
    return { brief: { ...base(copy, "spec", false), specs: rows, footnote: top ? "Week labels are routine stages; the result line is as stated on the product page." : "Week labels are routine stages, not results." } };
  },
  // Product in hand: a lifestyle photo of the product's user holding the real pack. ChatGPT gets the label-checked
  // pack image and must keep the label identical; the label check runs on the result (up to 3 rounds). AI person: Severe.
  in_hand: ({ copy, fresh }) => {
    if (!fresh) return { notFit: "made fresh on every Build (ChatGPT, label-checked)" };
    return { brief: { ...base(copy, "texture", true), tag: "", footnote: "AI-generated image. The pack label is checked against the real product.", ai_label_required: true } };
  },
  spec: ({ copy, sheet }) => {
    const rows = [];
    const a = lockedActives(sheet)[0];
    if (a) rows.push({ label: "Active", value: strengthOf(a), cites: [nameFact(sheet)] });
    rows.push(...labelRows(sheet).filter((r) => !/^note$/i.test(r.label)));
    if (rows.length < 2) return { notFit: "the page has too few short label lines (skin type, concerns, when to use)" };
    return { brief: { ...base(copy, "spec", false), specs: rows.slice(0, 3) } };
  },

  callouts: ({ copy, sheet, field }) => {
    const auto = shortClaims(sheet, 60).filter((f) => f.text !== copy.headline).slice(0, 2);
    const c = [field("c1", auto[0]?.text, "Callout 1 (up to 60 characters)", { max: 60, cites: auto[0] && [auto[0].id] }), field("c2", auto[1]?.text, "Callout 2 (up to 60 characters)", { max: 60, cites: auto[1] && [auto[1].id] })];
    return { brief: { ...base(copy, "callouts", false), callouts: c.map((x, i) => ({ text: x.text || P(`Callout ${i + 1}: a short page fact`), cites: x.cites || [] })) }, missing: c.filter((x) => !x.text).map((_, i) => `callout line ${i + 1}`) };
  },

  socialproof: ({ copy, h }) => {
    const rv = goodReviews(h);
    if (!rv.average) return { notFit: "no star rating captured for this product" };
    return { brief: { ...base(copy, "socialproof", false), proof: { value: `${rv.average}/5`, label: `stars, from ${rv.total.toLocaleString("en-IN")} reviews`, source: `beminimalist.co reviews, captured ${rv.day}` }, citations: { ...(copy.citations || {}) } }, notes: [`Rating exactly as captured on ${rv.day} (never rounded). Check it on the live page before use.`] };
  },

  faq: ({ copy, sheet, field, v }) => {
    const seen = new Set();
    const qs = sheet.facts.filter((f) => f.kind === "faq" && /\?\s*$/.test(f.section) && f.section.length <= 90 && !seen.has(f.section) && seen.add(f.section)).map((f) => f.section);
    if (!qs.length) return { notFit: "the product page has no FAQ" };
    const STOP = new Set("what which when where does do is are can the for and with this that your you use using used good best recommended serum cream product skin face how why will should".split(" "));
    const toks = (s) => (String(s).toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !STOP.has(w));
    const activeWords = new Set(toks((sheet.actives || []).map((a) => a.name).join(" ")));
    const pool = sheet.facts.filter((f) => ["claim", "suitability", "usage"].includes(f.kind) && f.text.length <= 110);
    const answerFor = (q) => { const qt = toks(q).filter((w) => !activeWords.has(w)); let best = null; for (const f of pool) { const n = toks(f.text).filter((w) => qt.some((x) => x.slice(0, 5) === w.slice(0, 5))).length; if (n && (!best || n > best.n)) best = { n, f }; } return best?.f || null; };
    // The default question is one the page answers in a short fact and that doesn't read as a treatment claim (any FAQ
    // can still be picked).
    const calm = (x) => !/\b(treat|treatment|cure|heal|disease|prescri)/i.test(x);
    const q = qs.includes(v.question) ? v.question : qs.find((x) => calm(x) && answerFor(x)) || qs.find(calm) || qs[0];
    const auto = answerFor(q);
    const ans = field("answer", auto?.text, "Answer (from the product page, not the FAQ text)", { max: 110, cites: auto && [auto.id] });
    return {
      brief: { ...base(copy, "faq", false), headline: "", faq: { question: q, answer: ans.text || P("Answer from a product-page fact"), cites: ans.cites || [] }, caption: cap(copy.headline, copy.subhead, copy.footnote) },
      fieldsBefore: [{ key: "question", label: "Question (from the page's own FAQ)", value: q, options: qs.map((x) => ({ value: x, label: x })) }],
      missing: ans.text ? [] : ["an answer from a product-page fact (the page's FAQ answers can't be quoted as claims)"],
    };
  },

  thisvsthat: ({ copy, field }) => {
    const f = (k, l, m = 40) => field(k, "", l, { max: m });
    const a = [f("a_title", "Left column title (an approach, e.g. a habit — never a brand)", 24), f("a1", "Left point 1"), f("a2", "Left point 2 (optional)")];
    const b = [f("b_title", "Right column title (this product's approach)", 24), f("b1", "Right point 1"), f("b2", "Right point 2 (optional)")];
    const col = (x, ph) => ({ title: x[0].text || P(ph), items: [x[1], x[2]].filter((y) => y.text).map((y) => ({ text: y.text, cites: y.cites || [] })).concat(x[1].text ? [] : [{ text: P("Point"), cites: [] }]) });
    return { brief: { ...base(copy, "thisvsthat", false), columns: [col(a, "This"), col(b, "That")] }, missing: [a[0], a[1], b[0], b[1]].filter((x) => !x.text).map((x) => x.label.replace(/ \(.*/, "").toLowerCase()) };
  },

  oldnew: ({ copy, field }) => {
    const f = (k, auto, l, m = 40) => field(k, auto, l, { max: m });
    const o = [f("old_title", "Old way", "Old way title", 20), f("old1", "", "Old habit 1 (a habit or routine — never a brand)"), f("old2", "", "Old habit 2 (optional)")];
    const n = [f("new_title", "New way", "New way title", 20), f("new1", "", "New way 1 (from the product page)"), f("new2", "", "New way 2 (optional)")];
    const col = (x) => ({ title: x[0].text, items: [x[1], x[2]].filter((y) => y.text).map((y) => ({ text: y.text, cites: y.cites || [] })).concat(x[1].text ? [] : [{ text: P("Point"), cites: [] }]) });
    return { brief: { ...base(copy, "oldnew", false), old: col(o), new: col(n) }, missing: [o[1], n[1]].filter((x) => !x.text).map((x) => x.label.replace(/ \(.*/, "").toLowerCase()) };
  },

  usvsthem: ({ copy, sheet, field }) => {
    const f = (k, auto, l, m) => field(k, auto, l, { max: m });
    const us = field("us", sheet.title, "Our column", { max: 40, cites: [nameFact(sheet)] }), them = f("them", "", "Their column: an unnamed benchmark, ingredient or product type the page names (never a brand)", 40);
    const rows = [1, 2, 3].map((i) => [f(`r${i}_label`, "", `Row ${i}: what is compared${i > 1 ? " (optional)" : ""}`, 40), f(`r${i}_us`, "", `Row ${i}: ours`, 24), f(`r${i}_them`, "", `Row ${i}: theirs`, 24)]);
    const basis = f("basis", "", "Basis of the comparison (what was compared, how, source) — printed on the ad", 200);
    const got = rows.filter((r) => r[0].text && r[1].text && r[2].text);
    const missing = [them.text ? "" : "the 'them' column", got.length ? "" : "at least one full comparison row", basis.text ? "" : "the basis of the comparison"].filter(Boolean);
    return {
      brief: { ...base(copy, "usvsthem", true), compare: { us: us.text, them: them.text || P("Benchmark"), cites: [...(us.cites || []), ...(them.cites || [])], rows: got.length ? got.map((r) => ({ label: r[0].text, us: r[1].text, them: r[2].text, cites: [...new Set([...(r[0].cites || []), ...(r[1].cites || []), ...(r[2].cites || [])])] })) : [{ label: P("What is compared"), us: P("Ours"), them: P("Theirs"), cites: [] }] }, footnote: basis.text || P("Basis of the comparison") },
      missing,
    };
  },
};

// ---------- fresh AI images (user, 2026-10-05: "creating from scratch should not be showing old images") ----------
// Formats whose visual is an AI image. A Build never reuses library images for them: it queues one request per format
// (lib/generate.js) and the card shows "Making a new image..." until the studio's result arrives (inputs.requests[format]).
export const IMAGE_FORMATS = new Set(["person", "creator", "before_after", "timeline", "texture", "in_hand"]);
const SCENES = ["a bright bathroom sink in soft morning daylight", "a tidy bedroom vanity by a window", "a calm home corner with a plain wall and plant", "a sunlit kitchen counter"];
// Minimalist's look (its long-running statics): plain, neutral, uncluttered, natural light, no styling props.
const LOOK = "Style: plain and minimal, neutral whites and soft greys, natural daylight, uncluttered background, real-looking skin with no retouching or filters, no props or decoration.";
const NOPE = LOOK + " No text, no letters, no logos, no product, no bottle, no packaging in the picture; leave an empty area in the lower right for the real pack to be placed later. No skin close-ups, no claims of results.";
// Who uses the product and how, read from its own page (user, 2026-10-05: "double check that the lifestyle or person
// images are made for the user, because this is for babies"). Every scene is written for that use, not a generic
// adult face routine.
export function useCase(sheet) {
  const txt = `${sheet.url || ""} ${sheet.title || ""} ${(sheet.facts || []).slice(0, 25).map((f) => f.text).join(" ")}`.toLowerCase();
  if (/pediatric|\bbab(y|ies)\b|infant|newborn|toddler/.test(txt)) return "baby";
  if (/underarm|armpit|roll-?on/.test(txt)) return "underarm";
  if (/\bhair\b|scalp|shampoo/.test(txt)) return "hair";
  if (/\blip\b|lips\b/.test(txt)) return "lip";
  if (/\bbody\b|body lotion|body wash/.test(txt)) return "body";
  if (/\bspf\b|sunscreen|sun screen/.test(txt)) return "sun";
  return "face";
}
// The audiences a product page itself names (user, 2026-10-05: "this product can be used by adults with sensitive skin
// so that is also a strong angle ... these things should be gauged, like the audience being catered"). Each audience
// cites the page facts it rests on; nothing is assumed beyond them. The scene images rotate across the audiences, so one
// build covers more than one angle.
export function audiences(sheet) {
  const facts = sheet.facts || [], ids = (rx) => facts.filter((f) => rx.test(f.text)).map((f) => f.id);
  const out = [], use = useCase(sheet);
  const baby = ids(/\bbab(y|ies)\b|newborn|infant|pediatric/i);
  if (use === "baby") out.push({ key: "baby", label: "Parents of babies and newborns", cites: baby.slice(0, 3) });
  const sens = ids(/sensitive|eczema/i), allAges = ids(/0\s*\+|newborns? (&|and) up|all ages|\badults?\b|whole family|everyone|all skin types/i);
  if (sens.length && (use !== "baby" || allAges.length)) out.push({ key: "sensitive", label: use === "baby" ? "Grown-ups with sensitive or eczema-prone skin (the page says newborns and up, all skin types incl. sensitive)" : "People with sensitive skin", cites: [...new Set([...sens.slice(0, 2), ...allAges.slice(0, 1)])] });
  const oily = ids(/\boily\b|acne-?prone|combination skin/i), dry = ids(/\bdry\b(?! scalp)/i);
  if (use !== "baby" && oily.length) out.push({ key: "oily", label: "People with oily or acne-prone skin", cites: oily.slice(0, 2) });
  if (use !== "baby" && dry.length) out.push({ key: "dry", label: "People with dry skin", cites: dry.slice(0, 2) });
  if (!out.length) out.push({ key: "general", label: "Everyday users of the product", cites: [] });
  return out;
}
const WHO = { sensitive: "an adult with sensitive skin", oily: "an adult with oily skin", dry: "an adult with dry skin" };

// Result images (before/after, progress over weeks) are never made for baby products: no result claims on infants.
export const noResultImages = (sheet) => useCase(sheet) === "baby";
const USE = {
  face: { who: "an adult woman", act: (t) => `mid-way through her skincare routine with "${t}" on her face`, places: SCENES },
  sun: { who: "an adult", act: (t) => `applying sunscreen ("${t}") to the face and neck before stepping out`, places: ["a sunlit doorway at home", "a balcony in morning light", "a bright hallway by the front door", "a tidy bedroom by a window"] },
  hair: { who: "an adult", act: (t) => `parting their hair and applying a few drops of "${t}" to the scalp`, places: ["a bright bathroom mirror", "a tidy bedroom vanity by a window", "a calm home corner with a plain wall", "a sunlit dressing area"] },
  underarm: { who: "an adult in a sleeveless top", act: (t) => `rolling "${t}" onto the underarm while getting ready`, places: ["a bright bathroom", "a tidy bedroom by a wardrobe", "a sunlit dressing area", "a calm home corner"] },
  lip: { who: "an adult", act: (t) => `applying "${t}" to the lips`, places: SCENES },
  body: { who: "an adult", act: (t) => `smoothing "${t}" onto the arms after a shower`, places: ["a bright bathroom", "a tidy bedroom by a window", "a calm home corner", "a sunlit dressing area"] },
  baby: { who: "a parent with their baby", act: (t) => `gently washing the baby at bath time with "${t}", the baby calm and comfortable, wrapped partly in a soft white towel, shown from a respectful distance (no close-up of the baby's skin, baby fully covered except arms and head)`, places: ["a bright bathroom with a small baby bathtub", "a soft-lit nursery changing table", "a calm bathroom in morning daylight", "a tidy nursery by a window"] },
};
export function aiImagePrompt(id, sheet, variant = 0) {
  const t = sheet.title, use = useCase(sheet), place0 = USE[use].places[Math.max(0, variant - 1) % USE[use].places.length];
  // Which audience this image speaks to: person and creator take different audiences in the same build.
  const aud = audiences(sheet), a = aud[(Math.max(0, variant) + (id === "creator" ? 1 : 0)) % aud.length];
  let u = USE[use], place = place0;
  if (a.key === "sensitive" && use === "baby") { u = { who: WHO.sensitive, act: (x) => `gently washing their face and arms in the shower with a mild lather of "${x}", calm and comfortable`, places: ["a bright bathroom shower", "a calm bathroom in morning daylight", "a tidy bathroom sink", "a soft-lit bathroom"] }; place = u.places[Math.max(0, variant - 1) % u.places.length]; }
  else if (WHO[a.key] && use !== "baby") u = { ...u, who: WHO[a.key] };
  const nope = use === "baby" && u.who.includes("baby") ? `${LOOK} No text, no letters, no logos, no product, no bottle, no packaging in the picture; leave an empty area in the lower right for the real pack to be placed later. No nudity, no close-ups of the baby, no claims of results.` : NOPE;
  switch (id) {
    case "person": return { base: "none", prompt: `Create an image: a natural lifestyle photo of ${u.who} in ${place}, ${u.act(t)}, relaxed and candid, vertical 2:3. ${nope}` };
    case "creator": return { base: "none", prompt: u.who.includes("baby") ? `Create an image: a phone-camera style photo of a parent sharing a calm bath-time moment with their baby in ${place}, using "${t}", warm and real, vertical 2:3. ${nope}` : `Create an image: a selfie-style portrait of ${u.who} as a content creator in ${place}, phone-camera look, friendly, ${u.act(t)}, vertical 2:3. ${nope}` };
    case "before_after": return { base: "none", prompt: `Create an image: one vertical 2:3 picture made of two equal panels stacked top and bottom, the same ${u.who.replace(/^an? /, "")}, same light, angle and plain background in both, ${u.act(t)} in the second panel, neutral expression, labelled as an illustration for a "${t}" routine post. ${nope}` };
    case "timeline": return { base: "none", prompt: `Create an image: a vertical 2:3 picture made of four equal panels in a 2 by 2 grid showing the same ${u.who.replace(/^an? /, "")} in ${place} at four moments of a daily routine, ${u.act(t)}, same light and angle, no visible change in skin or hair between panels. ${nope}` };
    case "in_hand": return { base: "pack", prompt: `Create an image: a natural lifestyle photo of ${u.who} in ${place}, holding the attached product pack in one hand at chest height, label facing the camera and fully readable, relaxed and candid, vertical 2:3. ${LOOK} No other products, no extra text. Use the attached photo as the exact product.` };
    default: return { base: "pack", prompt: `Create an image: a close-up studio shot of the attached product pack standing on a clean white surface, with a small swatch of its texture beside it, soft light, vertical 2:3 (${t}). Plain and minimal: pure white background, no props, no extra text.` };
  }
}
// ---------- ranking (the library's) ----------
const rankCache = new Map();
function ranking(sheet) {
  const h = handleOf(sheet);
  const key = `${h}|${sheet.title}|${sheet.facts.map((f) => f.kind).join(",")}`;
  if (!rankCache.has(key)) {
    const r = rankArchetypes({ product_handle: h, sheet, objective: "sales" });
    rankCache.set(key, new Map(r.full_ranking.map((x) => [x.id, x])));
  }
  return rankCache.get(key);
}

// ---------- one format: brief → spec (drawn) + ad (scored) + what it still needs ----------
export function buildFormat(id, copy, sheet, inputs = {}) {
  const fmt = FORMATS.find((f) => f.id === id);
  if (!fmt) throw new Error(`Unknown format "${id}"`);
  const h = handleOf(sheet);
  const inp = inputs[id] || {};
  const v = inp.values || {}, c = inp.cites || {}, photos = inp.photos || {};
  const fields = [], typed = [];
  // A field: the user's value if given, else the automatic one. A value keeps its citations only while they still check
  // out against the page; anything else the user typed is flagged as unsourced.
  const field = (key, auto, label, extra = {}) => {
    const given = typeof v[key] === "string" ? v[key].trim() : null;
    const text = (given ?? auto ?? "").trim();
    let cites = given !== null && given !== (auto || "") ? c[key] : c[key] || extra.cites;
    if (cites && !citesOk(text, cites, sheet)) cites = null;
    if (given !== null && given !== (auto || "").trim() && given && !cites && !/_title$/.test(key)) typed.push({ key, label, text });
    fields.push({ key, label, value: text, max: extra.max, cited: Boolean(cites?.length), typed: typed.some((x) => x.key === key) });
    return { text, cites, label };
  };
  const variant = Math.max(0, Math.floor(Number(inputs.variant) || 0));
  const fresh = Boolean(inputs.fresh);
  const out = BUILD[id]({ copy, sheet, h, v, c, photos, field, variant, fresh });
  if (out.notFit) return { id, notFit: out.notFit };
  const brief = out.brief;
  const sheets = out.sheets || { _main: sheet };
  if (!sheets._main) sheets._main = sheet;

  // Drawn: the brief with its [placeholders], through the library's spec builder.
  const spec = specFromBrief(brief, sheets, "_main");
  const vis = packVisual(h, sheet);
  // No verified render for this product: its new studio render (label-checked) replaces the page photo once it is done.
  const rr = !vis?.file && inputs.requests?.render ? requestState(inputs.requests.render) : null;
  const newRender = rr?.status === "done" && rr.url ? rr.url : "";
  Object.assign(spec, { format: id, imageSrc: newRender || visualSrc(h, vis), cutout: Boolean(vis?.cutout), accent: ACCENT[h] || "" });
  if (out.textureSrc) spec.textureSrc = out.textureSrc;
  // The product's own AI images, reused (the browser loads them through /img/; render.js draws them like pipeline/08_compose.js).
  if (out.textureSceneRel) Object.assign(spec, { textureScene: true, imageSrc: imgUrl(out.textureSceneRel), cutout: false, canvas: "#FFFFFF", aiLabel: true });
  if (out.personAi) { spec.personSrc = imgUrl(out.personAi.rel); spec.aiLabel = true; }
  if (out.framesAi && id === "before_after") { spec.photoSrcs = out.framesAi.rels.map(imgUrl); spec.aiLabel = true; }
  if (out.framesAi && id === "timeline") { spec.frames = (spec.frames || []).map((f, i) => ({ ...f, imageSrc: imgUrl(out.framesAi.rels[i]) })); spec.aiLabel = true; }
  const hydrateItem = (item, handle) => { const iv = packVisual(handle, sheets[item.product_handle]); return { ...item, imageSrc: visualSrc(handle, iv), cutout: Boolean(iv?.cutout), accent: ACCENT[handle] || "" }; };
  spec.steps = (spec.steps || []).map((s, i) => hydrateItem(s, brief.steps[i].product_handle === "_main" ? h : brief.steps[i].product_handle));
  spec.range = (spec.range || []).map((s, i) => hydrateItem(s, brief.range[i].product_handle === "_main" ? h : brief.range[i].product_handle));

  // Scored: the same brief without placeholders (an empty slot is not a claim).
  const clean = stripPlaceholders(brief);
  const ad = adFromBrief(clean, sheets, "_main");
  const extraSheets = Object.entries(sheets).filter(([k]) => k !== "_main").map(([, s]) => s);

  // A fresh AI image: from this Build's request when it has finished; else the card says it is being made (nothing drawn).
  let pending = null, imageNeed = null, imageRq = null;
  const uploaded = { person: photos.person, creator: photos.person, before_after: photos.before && photos.after, timeline: false, texture: photos.texture }[id];
  if (fresh && IMAGE_FORMATS.has(id) && !uploaded && !(id === "texture" && (out.textureSrc || out.textureSceneRel))) {
    imageNeed = aiImagePrompt(id, sheet, variant);
    imageRq = inputs.requests?.[id] ? requestState(inputs.requests[id]) : null;
    if (imageRq?.url) {
      const u = imageRq.url;
      if (id === "person" || id === "creator") { spec.personSrc = u; spec.aiLabel = true; }
      if (id === "before_after") { spec.photoSrcs = [u, u]; spec.photoSheet = true; spec.aiLabel = true; }
      if (id === "timeline") { spec.frames = (spec.frames || []).map((f) => ({ ...f, imageSrc: u })); spec.frameSheet = true; spec.aiLabel = true; }
      if (id === "texture" || id === "in_hand") { Object.assign(spec, { textureScene: true, imageSrc: u, cutout: false, canvas: "#FFFFFF", aiLabel: true }); if (id === "texture") out.textureSceneRel = "fresh"; }
    } else if (imageRq?.status === "failed") pending = { state: "failed", text: imageRq.notes || "The new image could not be made. Build again to retry." };
    else if (!imageRq) pending = { state: "unavailable", text: process.env.ONLINE === "1" ? "This format needs a new image: add your OpenAI key (Settings) and build again to make it. Nothing old is shown instead." : "No image request was queued for this format (needs a beminimalist.co product page). Nothing old is shown instead." };
    else if (!studioAvailable()) pending = { state: "no_studio", text: "New image needs the Image Studio: run npm run studio (ChatGPT) or add an OpenAI key" };
    else pending = { state: "making", text: "Making a new image…", progress: imageRq.progress || "" };
  }

  // The product's own render is still in the label-check loop: the ad waits for it (hidden), so no ad is drawn on the
  // page's studio photo (user, 2026-10-05: "why are we not using the loop i established for getting the product image?").
  // If the loop fails its label check, the page photo is used and the ad says so.
  if (!pending && rr && !["done", "failed", "needs_review"].includes(rr.status)) pending = studioAvailable() ? { state: "making", text: "Making the label-checked product render…", progress: rr.progress || "" } : { state: "no_studio", text: "The product render needs an image maker: add an OpenAI key, or run npm run studio and sign in to ChatGPT" };
  if (rr && ["failed", "needs_review"].includes(rr.status)) spec.renderNote = "The studio render did not pass its label check, so the product page photo is used.";

  // Layout check on what will be drawn once the photos are in.
  const ph = { ...spec, photos: (photos.before && photos.after) || out.photosOk ? ["x", "x"] : spec.photos };
  const layout = pending ? [] : layoutProblems(ph).filter((p) => !(/study photos/.test(p) && (out.missing || []).length));

  // Ranking and risk, from the library's archetype scoring of the same catalog.
  const rows = ranking(sheet);
  const best = fmt.templates.map((t) => rows.get(t)).filter(Boolean).sort((a, b) => b.score - a.score)[0];
  let risk = best?.risk || "low", riskNote = best?.risk_note || "";
  if (fmt.person) { risk = "severe"; riskNote = (["before_after", "timeline"].includes(fmt.id) ? SOURCE_RISK["REAL PHOTO:result"] : SOURCE_RISK["REAL PHOTO:people"]).note; }
  if (out.textureSceneRel && !pending) { risk = "low"; riskNote = "AI-made texture swatch beside the label-verified pack: Low risk (user decision 2026-10-05, DEC-04); keeps the AI-generated - illustrative mark for transparency."; }
  if (id === "texture" && !textureOf(sheet) && photos.texture) { risk = worst(risk, "medium"); riskNote = "Uploaded photo: confirm it's a real, unretouched photo of this product (never AI-made)."; }
  if (typed.length) { risk = worst(risk, "medium"); riskNote = `${riskNote} Lines typed in the app have no page source yet: a reviewer must check them.`.trim(); }

  const missing = out.missing || [];
  const meta = {
    id, label: fmt.label, layout: fmt.layout, person: Boolean(fmt.person), ai_draft: Boolean(fmt.ai),
    template: best ? { id: best.id, name: best.name, why: best.why, score: best.score } : null, templates: fmt.templates,
    score: best?.score ?? 0, risk, risk_label: LABEL[risk], risk_note: riskNote,
    status: pending ? "generating" : missing.length ? "needs_input" : "ready", missing,
    pending, image_need: imageNeed, image_review: imageRq?.status === "needs_review", image_note: imageRq?.url ? imageRq.notes : "", request_id: imageRq?.id || "",
    fields: [...(out.fieldsBefore || []), ...fields], photos: (out.photos || []).map((p) => ({ ...p, have: Boolean(photos[p.key]) })),
    typed, notes: out.notes || [], visual: newRender ? "new studio render of the pack (label-checked)" : out.textureSceneRel && !imageRq ? "approved ChatGPT texture shot (pack label checked)" : vis?.source || "",
  };
  return { id, meta, spec, ad, extraSheets, layout, brief };
}

// Every format for this product: ranked list (ready and needs-input), plus what isn't offered and why.
export function listFormats(copy, sheet, inputs = {}) {
  const built = [], notShown = [];
  for (const f of FORMATS) {
    const b = buildFormat(f.id, copy, sheet, inputs);
    if (b.notFit) notShown.push({ id: f.id, label: f.label, why: b.notFit });
    else built.push(b);
  }
  built.sort((a, b) => b.meta.score - a.meta.score);
  built.forEach((b, i) => (b.meta.rank = i + 1));
  const rows = ranking(sheet);
  for (const n of NOT_IN_APP) notShown.push({ id: `t${n.templates.join("-")}`, label: n.templates.map((t) => rows.get(t)?.name).filter(Boolean).join(", "), why: n.why });
  return { built, notShown };
}

