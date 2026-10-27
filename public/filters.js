// Filtering, sorting, counting and URL-hash logic for the existing-ads library and the image library.
// Pure functions only (no DOM, no fetch), so the browser app and node:test (tests/library_filters.test.js) share one copy.
// The app fetches each list once and filters it here, in the browser.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const words = (q) => String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
const pretty = (h) => String(h || "").replace(/-/g, " ");
const cmp = (a, b) => String(a ?? "").localeCompare(String(b ?? ""));
const uniq = (a) => [...new Set(a)];
const pick = (list, allowed) => uniq(list.filter((x) => allowed.includes(x)));
const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const yesNo = (v) => (v === "yes" || v === "no" ? v : "");
const pctInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0; };

// ====================================================================================================================
// Existing ads (the shape of /api/library and /api/library-all ads: lib/library.js)
// ====================================================================================================================

export const VERDICTS = [
  { key: "ready", code: "READY_FOR_REVIEW", label: "Ready for review" },
  { key: "fix", code: "NEEDS_CHANGES", label: "Needs fixes" },
  { key: "blocked", code: "BLOCKED", label: "Blocked" },
];
export const RISKS = [{ key: "low", label: "Low" }, { key: "medium", label: "Medium" }, { key: "high", label: "High" }, { key: "severe", label: "Severe" }];
export const SIZES = [{ key: "4x5", label: "4:5" }, { key: "9x16", label: "9:16" }, { key: "hi", label: "Hindi" }, { key: "ta", label: "Tamil" }];
export const AD_SORTS = [
  { key: "mixed", label: "Mixed (random)" },
  { key: "fmt", label: "Format, then newest", modes: ["p"] },
  { key: "align", label: "Best alignment score" },
  { key: "win", label: "Best win score" },
  { key: "new", label: "Newest" },
  { key: "product", label: "Product A to Z" },
];
// "p" = one product's library, "all" = every product.
// Mixed by default (user, 2026-10-05: "randomise the library"): a shuffle that stays put while you filter, new per visit.
export const defaultAdSort = () => "mixed";
const SEED = Math.floor(Math.random() * 2 ** 31);
const mix = (s) => { let h = SEED; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0; return h; };
export const adSortsFor = (mode) => AD_SORTS.filter((s) => !s.modes || s.modes.includes(mode));

export const adDefaults = () => ({ product: "", fmt: "", verdict: [], exp: "", risk: [], ai: "", align: 0, win: 0, size: [], q: "", sort: "" });

// The verdict the cards show: the scorer's (scores.verdict) when the ad is scored, else read from the description file's line.
export function verdictKey(ad) {
  const code = ad?.scores?.verdict;
  const hit = VERDICTS.find((v) => v.code === code);
  if (hit) return hit.key;
  const t = String(ad?.verdict || "");
  if (/^do not publish|^blocked/i.test(t)) return "blocked";
  if (/^fix/i.test(t)) return "fix";
  if (/^ready/i.test(t)) return "ready";
  return "";
}

// "4x5", "9x16", "hi", "ta" for each size file this ad has (1:1 always exists and is not offered as a filter).
export const sizeKeys = (ad) => (ad?.placements || []).map((p) => String(p.label || "").replace(":", "x").toLowerCase());

const adHays = new WeakMap();
function adHay(ad) {
  let h = adHays.get(ad);
  if (h === undefined) {
    h = [ad.product, pretty(ad.handle), ad.fmt_title, ad.title, ad.template, ad.caption, ...(ad.on_image || [])].join(" ").toLowerCase();
    adHays.set(ad, h);
  }
  return h;
}

const AD_TEST = {
  product: (a, s) => !s.product || a.handle === s.product,
  fmt: (a, s) => !s.fmt || a.fmt === s.fmt,
  verdict: (a, s) => !s.verdict.length || s.verdict.includes(verdictKey(a)),
  exp: (a, s) => !s.exp || Boolean(a.exportable) === (s.exp === "yes"),
  risk: (a, s) => !s.risk.length || s.risk.includes(String(a.risk || "").toLowerCase()),
  ai: (a, s) => !s.ai || Boolean(a.ai) === (s.ai === "yes"),
  // An ad that has not been scored has no score, so it cannot meet a minimum.
  align: (a, s) => s.align <= 0 || (num(a.scores?.alignment) ?? -1) >= s.align,
  win: (a, s) => s.win <= 0 || (num(a.scores?.win) ?? -1) >= s.win,
  // "Size available": the ad must have every ticked size.
  size: (a, s) => { if (!s.size.length) return true; const have = sizeKeys(a); return s.size.every((k) => have.includes(k)); },
  q: (a, s) => { const w = words(s.q); if (!w.length) return true; const hay = adHay(a); return w.every((x) => hay.includes(x)); },
};
export const AD_FILTER_KEYS = Object.keys(AD_TEST);

// skip: leave one filter out (used to count what each option of that filter would add).
export function filterAds(ads, state, { skip = "" } = {}) {
  const tests = AD_FILTER_KEYS.filter((k) => k !== skip).map((k) => AD_TEST[k]);
  return ads.filter((a) => tests.every((t) => t(a, state)));
}

// Number of filters switched on (sort is not a filter).
export function activeAdFilters(state, mode = "p") {
  const d = adDefaults();
  return AD_FILTER_KEYS.filter((k) => !(mode === "p" && k === "product") && JSON.stringify(state[k]) !== JSON.stringify(d[k])).length;
}

const by = (...fns) => (a, b) => { for (const f of fns) { const r = f(a, b); if (r) return r; } return 0; };
const scoreDesc = (key) => (a, b) => (num(b.scores?.[key]) ?? -1) - (num(a.scores?.[key]) ?? -1); // unscored ads last
const byProduct = (a, b) => cmp(a.product, b.product);
const byFmt = (a, b) => cmp(a.fmt_title, b.fmt_title);
const byNewest = (a, b) => cmp(b.run, a.run);
const byId = (a, b) => cmp(a.id, b.id);
const AD_ORDER = {
  mixed: (a, b) => mix(a.id) - mix(b.id),
  fmt: by(byFmt, byProduct, byNewest, byId),
  align: by(scoreDesc("alignment"), scoreDesc("win"), byProduct, byId),
  win: by(scoreDesc("win"), scoreDesc("alignment"), byProduct, byId),
  new: by(byNewest, byProduct, byFmt, byId),
  product: by(byProduct, byFmt, byNewest, byId),
};
export function sortAds(ads, sort, mode = "p") {
  const key = AD_ORDER[sort] && adSortsFor(mode).some((s) => s.key === sort) ? sort : defaultAdSort(mode);
  return [...ads].sort(AD_ORDER[key]);
}

// What an ad contributes to each facet (the options with counts next to them).
const AD_VALUES = {
  product: (a) => [a.handle],
  fmt: (a) => [a.fmt],
  verdict: (a) => [verdictKey(a)],
  risk: (a) => [String(a.risk || "").toLowerCase()],
  exp: (a) => [a.exportable ? "yes" : "no"],
  ai: (a) => [a.ai ? "yes" : "no"],
  size: sizeKeys,
};
// How many ads each option of one filter would show with every OTHER filter as it is now: { option: n }.
export function adFacetCounts(ads, state, key) {
  const out = {};
  for (const a of filterAds(ads, state, { skip: key })) for (const v of AD_VALUES[key](a)) out[v] = (out[v] || 0) + 1;
  return out;
}

// The distinct products and formats in a list, for the two dropdowns.
export function adOptions(ads) {
  const products = new Map(), formats = new Map();
  for (const a of ads) { products.set(a.handle, a.product || pretty(a.handle)); formats.set(a.fmt, a.fmt_title || a.fmt); }
  const sorted = (m) => [...m].map(([key, label]) => ({ key, label })).sort((a, b) => cmp(a.label, b.label));
  return { products: sorted(products), formats: sorted(formats) };
}

// "37 of 153 ads", or just "153 ads" when nothing is filtered out.
export function countText(shown, total, noun = "ad") {
  const n = (k) => `${k} ${noun}${k === 1 ? "" : "s"}`;
  return shown === total ? n(total) : `${shown} of ${n(total)}`;
}

// Makes any state object safe: unknown values dropped, sliders 0 to 100.
export function cleanAdState(raw = {}) {
  const d = adDefaults();
  return {
    product: String(raw.product || ""), fmt: String(raw.fmt || ""),
    verdict: pick(raw.verdict || [], VERDICTS.map((v) => v.key)), exp: yesNo(raw.exp),
    risk: pick(raw.risk || [], RISKS.map((r) => r.key)), ai: yesNo(raw.ai),
    align: pctInt(raw.align ?? d.align), win: pctInt(raw.win ?? d.win),
    size: pick(raw.size || [], SIZES.map((s) => s.key)),
    q: String(raw.q || "").slice(0, 200), sort: AD_SORTS.some((s) => s.key === raw.sort) ? raw.sort : "",
  };
}

// ====================================================================================================================
// Images (the shape of /api/images entries: lib/images.js)
// ====================================================================================================================

export const IMG_TYPES = { requested: "Image studio request", verified_render: "Verified pack render", ai_texture: "Texture shot (verified)", cutout: "Cut-out", real_pack: "Real pack photo", real_texture: "Real texture", real_photo: "Real photo (other)", ai_scene: "AI scene / person / frame", review_photo: "Customer review photo" };
// The filter chips group the finer types the library keeps.
export const IMG_GROUPS = [
  { key: "real", label: "Real photo", types: ["real_pack", "real_photo"] },
  { key: "cutout", label: "Cut-out", types: ["cutout"] },
  { key: "render", label: "Verified render", types: ["verified_render"] },
  { key: "texture", label: "Texture", types: ["real_texture", "ai_texture"] },
  { key: "scene", label: "AI scene (Severe)", types: ["ai_scene"] },
  { key: "review", label: "Review photo (reference only)", types: ["review_photo"] },
  { key: "studio", label: "Studio request", types: ["requested"] },
];
export const IMG_SORTS = [
  { key: "", label: "Type, then product" },
  { key: "product", label: "Product A to Z" },
  { key: "new", label: "Newest first" },
  { key: "usable", label: "Usable in ads first" },
];
const IMG_USE = new Set(["real_pack", "cutout", "verified_render"]);
// Same rule as the "Make new ads for this product" button: a real pack photo, a cut-out or an approved verified render of a product.
export const usableInAds = (e) => Boolean(e?.handle) && IMG_USE.has(e.type) && e.use_in_ad !== false;
export const imgGroupOf = (e) => IMG_GROUPS.find((g) => g.types.includes(e.type))?.key || "";

export const imgDefaults = () => ({ type: [], product: "", use: "", q: "", sort: "" });

const imgHays = new WeakMap();
function imgHay(e) {
  let h = imgHays.get(e);
  if (h === undefined) {
    h = [String(e.type || "").replace(/_/g, " "), IMG_TYPES[e.type], e.words, e.label, e.handle, pretty(e.handle), e.product, e.notes, e.prompt, e.file, e.ai ? "ai generated" : "real", e.status, e.run].join(" ").toLowerCase();
    imgHays.set(e, h);
  }
  return h;
}
const IMG_TEST = {
  type: (e, s) => !s.type.length || s.type.includes(imgGroupOf(e)),
  product: (e, s) => !s.product || e.handle === s.product,
  use: (e, s) => !s.use || usableInAds(e) === (s.use === "yes"),
  q: (e, s) => { const w = words(s.q); if (!w.length) return true; const hay = imgHay(e); return w.every((x) => hay.includes(x)); },
};
export const IMG_FILTER_KEYS = Object.keys(IMG_TEST);
export function filterImages(list, state, { skip = "" } = {}) {
  const tests = IMG_FILTER_KEYS.filter((k) => k !== skip).map((k) => IMG_TEST[k]);
  return list.filter((e) => tests.every((t) => t(e, state)));
}
export const activeImgFilters = (state) => { const d = imgDefaults(); return IMG_FILTER_KEYS.filter((k) => JSON.stringify(state[k]) !== JSON.stringify(d[k])).length; };

// The list arrives already in the default order (type, then product), so the default sort keeps it; the others are stable on top of it.
export function sortImages(list, sort) {
  const idx = new Map(list.map((e, i) => [e, i]));
  const keep = (a, b) => idx.get(a) - idx.get(b);
  const order = {
    product: by((a, b) => cmp(a.product || a.handle, b.product || b.handle), keep),
    new: by((a, b) => cmp(b.requested_at || "", a.requested_at || ""), keep), // only studio images carry a date; they come first, newest first
    usable: by((a, b) => usableInAds(b) - usableInAds(a), keep),
  }[sort];
  return order ? [...list].sort(order) : [...list];
}

const IMG_VALUES = { type: (e) => [imgGroupOf(e)], product: (e) => [e.handle], use: (e) => [usableInAds(e) ? "yes" : "no"] };
export function imgFacetCounts(list, state, key) {
  const out = {};
  for (const e of filterImages(list, state, { skip: key })) for (const v of IMG_VALUES[key](e)) out[v] = (out[v] || 0) + 1;
  return out;
}
export function imgProductOptions(list) {
  const m = new Map();
  for (const e of list) if (e.handle) m.set(e.handle, e.product || e.handle);
  return [...m].map(([key, label]) => ({ key, label })).sort((a, b) => cmp(a.label, b.label));
}
export function cleanImgState(raw = {}) {
  return {
    type: pick(raw.type || [], IMG_GROUPS.map((g) => g.key)), product: String(raw.product || ""), use: yesNo(raw.use),
    q: String(raw.q || "").slice(0, 200), sort: IMG_SORTS.some((s) => s.key && s.key === raw.sort) ? raw.sort : "",
  };
}

// ====================================================================================================================
// The URL hash, so a filtered view can be shared and reopened.
//   #t=images                         the tab (Ads for a product is the default and is left out)
//   lib=all | lib=p&h=<handle>        the existing-ads view: every product, or one product's library
//   product fmt verdict exp risk ai align win size q sort    the ad filters (verdict/risk/size are comma lists)
//   itype iprod iuse iq isort         the image filters
// Only values that differ from the defaults are written.
// ====================================================================================================================

const TABS = ["generate", "score", "images"];

export function parseHash(hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const g = (k) => p.get(k) || "";
  const lib = g("lib") === "all" ? "all" : g("lib") === "p" && /^[a-z0-9-]+$/i.test(g("h")) ? "p" : "";
  return {
    tab: TABS.includes(g("t")) ? g("t") : "generate",
    lib, h: lib === "p" ? g("h") : "",
    ads: cleanAdState({ product: g("product"), fmt: g("fmt"), verdict: csv(g("verdict")), exp: g("exp"), risk: csv(g("risk")), ai: g("ai"), align: g("align") || 0, win: g("win") || 0, size: csv(g("size")), q: g("q"), sort: g("sort") }),
    images: cleanImgState({ type: csv(g("itype")), product: g("iprod"), use: g("iuse"), q: g("iq"), sort: g("isort") }),
  };
}

// view: { tab, lib: "" | "all" | "p", h, ads, images }. Returns "" (nothing to remember) or "#...".
export function buildHash({ tab = "generate", lib = "", h = "", ads = adDefaults(), images = imgDefaults() } = {}) {
  const p = new URLSearchParams();
  if (tab !== "generate" && TABS.includes(tab)) p.set("t", tab);
  if (lib === "all" || (lib === "p" && h)) {
    p.set("lib", lib);
    if (lib === "p") p.set("h", h);
    const a = cleanAdState(ads), d = adDefaults();
    for (const k of ["product", "fmt", "exp", "ai", "q"]) if (a[k] && !(lib === "p" && k === "product")) p.set(k, a[k]);
    for (const k of ["verdict", "risk", "size"]) if (a[k].length) p.set(k, a[k].join(","));
    for (const k of ["align", "win"]) if (a[k] !== d[k]) p.set(k, String(a[k]));
    if (a.sort && a.sort !== defaultAdSort(lib)) p.set("sort", a.sort);
  }
  const i = cleanImgState(images);
  if (i.type.length) p.set("itype", i.type.join(","));
  if (i.product) p.set("iprod", i.product);
  if (i.use) p.set("iuse", i.use);
  if (i.q) p.set("iq", i.q);
  if (i.sort) p.set("isort", i.sort);
  const s = p.toString().replace(/%2C/gi, ",");
  return s ? `#${s}` : "";
}
