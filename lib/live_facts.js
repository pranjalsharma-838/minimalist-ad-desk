// Live data the app needs beside the product page (same captures and the same wording as pipeline/00_product_run.js):
// prices + sitewide offers (scripts/collect_offers.js) and the rating + verified reviews (scripts/collect_reviews.js).
// They become citable facts PRICE*, OFFER*, RATING, REV* so the offer, price and rating formats quote them exactly,
// with the capture date. Read-only: nothing here writes to brand_packs/.
import fs from "node:fs";
import { goodReviews } from "./reviews.js";

const RAW = new URL("../brand_packs/minimalist/raw/", import.meta.url);
// The beminimalist.co handle: Minimalist-only data (verified renders, captured offers / reviews, accent colours) is keyed by it.
// Any other brand's page has none (handleOf is "") so none of that is ever used for it; requestHandle names its image requests.
export const handleOf = (sheet) => {
  const u = String(sheet?.url || "");
  if (sheet?.brand_site === "other") return "";
  try { if (u && !/(^|\.)beminimalist\.co$/i.test(new URL(u).hostname)) return ""; } catch { return ""; }
  return (u.match(/\/products\/([^/?#]+)/) || [])[1] || "";
};
export const requestHandle = (sheet) => handleOf(sheet) || sheet?.slug || "";
export const isMinimalist = (sheet) => sheet?.brand_site !== "other";

let offersCache = null;
export function latestOffers() {
  if (offersCache) return offersCache;
  const f = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((x) => /^offers_.*\.json$/.test(x)).sort().pop() : null;
  offersCache = f ? JSON.parse(fs.readFileSync(new URL(f, RAW), "utf8")) : null;
  if (offersCache) offersCache.day = offersCache.captured_at.slice(0, 10);
  return offersCache;
}

// The captured sitewide offers, in a stable order, with the id they get as facts (OFFER1..n).
export function sitewideOffers() {
  const o = latestOffers();
  return (o?.sitewide || []).map((x, i) => ({ id: `OFFER${i + 1}`, text: x.text, type: x.type, terms: x.terms_page || "", expiry: x.expiry || "", day: o.day }));
}

// The website price of each size (first = the size the page opens on), as captured.
export function pricesOf(handle) {
  const o = latestOffers();
  return (o?.products?.[handle]?.website?.variants || []).map((v, i) => ({ id: `PRICE${i + 1}`, ...v, day: o.day }));
}

// Same facts, same ids, same wording as the library pipeline (00_product_run.js sheetFor).
export function addLiveFacts(sheet) {
  const h = handleOf(sheet);
  if (!h || !sheet?.facts) return sheet;
  const s = { ...sheet, facts: sheet.facts.filter((x) => !["price", "offer", "review", "rating"].includes(x.kind)) };
  const o = latestOffers();
  if (o) {
    const day = o.day, p = o.products?.[h];
    (p?.website?.variants || []).forEach((v, i) => s.facts.push({ id: `PRICE${i + 1}`, kind: "price", section: "price (website)", text: `${v.name}: Rs. ${v.price}${v.mrp ? ` (MRP Rs. ${v.mrp}; ${v.pct_off_computed}% below MRP, both prices shown on the page)` : " (no MRP shown)"} — beminimalist.co, captured ${day}` }));
    if (p?.amazon_in?.price) s.facts.push({ id: "PRICE_AMZ", kind: "price", section: "price (Amazon.in)", text: `Amazon.in: Rs. ${p.amazon_in.price}${p.amazon_in.pct_off_shown ? ` (${p.amazon_in.pct_off_shown}% off as shown)` : ""}${p.amazon_in.coupon ? `; ${p.amazon_in.coupon}` : ""} — search result, captured ${day} (verify it is the brand's own listing)` });
    o.sitewide.forEach((x, i) => s.facts.push({ id: `OFFER${i + 1}`, kind: "offer", section: "sitewide offer (website banner)", text: `"${x.text}" — beminimalist.co homepage, captured ${day}${x.expiry ? `, ${x.expiry}` : ", no end date shown"}; terms: ${x.terms_page || "site"}` }));
  }
  const rv = goodReviews(h);
  if (rv.average) s.facts.push({ id: "RATING", kind: "rating", section: "reviews (Yotpo, website)", text: `${rv.average} out of 5 stars from ${rv.total.toLocaleString("en-IN")} reviews on beminimalist.co, captured ${rv.day}` });
  rv.reviews.forEach((r, i) => s.facts.push({ id: `REV${i + 1}`, kind: "review", section: "customer review (verbatim; quote exactly, no edits beyond trimming with …)", text: `"${r.text}" — ${r.name}, verified buyer, ${r.stars}★, ${r.date} (beminimalist.co, captured ${rv.day})` }));
  return s;
}
