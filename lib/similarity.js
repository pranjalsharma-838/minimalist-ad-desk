// Product-to-product matcher: competitor's advertised product -> most similar SKU in our dictionary
// (research/sku_dictionary.json). Transparent points, not embeddings, so a reviewer can see WHY a
// product was picked:
//   same active family  +6 first, +2 each extra (cap +10) — the thing the ad is really selling
//   same function word  +2 (wash/cream/serum/mask/roll-on…)
//   different area      -8 (body / hair / eye / lip vs face)
//   same format         +3 (adjacent +1)   — a face wash ad should become a cleanser ad
//   shared concern      +1 each (cap 3)
//   close concentration +1 same / +0.5 within 2x (only for a shared active)
//   demand              up to +1 for top sellers (rank 1 = +1.0, rank 20 = +0.05)
// Excludes Pediatrics always, and hair products unless the competitor product is haircare.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DICT = JSON.parse(fs.readFileSync(path.join(here, "..", "research", "sku_dictionary.json"), "utf8"));

// Active families: synonyms and close siblings that a shopper would see as "the same kind of product".
const FAMILIES = {
  salicylic: /salicylic|\bbha\b|\blha\b|capryloyl/i,
  vitamin_c: /vitamin\s?c\b|ascorbic|ethyl ascorbic|\bvit\.?\s?c\b/i,
  niacinamide: /niacinamide|vitamin\s?b3/i,
  retinoid: /retin(ol|al|oid)|bakuchiol/i,
  arbutin: /arbutin/i,
  tranexamic: /tranexamic/i,
  kojic: /kojic/i,
  hyaluronic: /hyaluronic|\bha\b|sodium hyaluronate/i,
  ceramide: /ceramide/i,
  aha: /\baha\b|glycolic|lactic|mandelic/i,
  pha: /\bpha\b|polyhydroxy|gluconolactone/i,
  peptide: /peptide|matrixyl|copper/i,
  sunscreen: /\bspf\b|sunscreen|sun\s?screen|uv filter/i,
  azelaic: /azelaic/i,
  centella: /cica|centella|madecassoside/i,
  squalane: /squalane/i,
  b5: /vitamin\s?b5|panthenol/i,
  b12: /vitamin\s?b12|cyanocobalamin/i,
  zinc: /\bzinc\b/i,
};
const ADJACENT = { serum: ["toner"], toner: ["serum"], moisturizer: ["sunscreen"], sunscreen: ["moisturizer"], cleanser: [] };

export const familiesOf = (text) => Object.entries(FAMILIES).filter(([, re]) => re.test(text)).map(([k]) => k);
const pctNum = (p) => (p ? parseFloat(String(p).replace(/^0+(?=\d)/, "")) : null);

// comp: { name, actives: [{name, pct}], format, concerns: [] }
export function scoreSku(comp, sku) {
  const why = [];
  let score = 0;
  const compText = [comp.name, ...(comp.actives || []).map((a) => a.name)].join(" ");
  const cf = familiesOf(compText);
  const sf = familiesOf([sku.title, ...sku.actives.map((a) => a.name)].join(" "));
  const shared = cf.filter((f) => sf.includes(f));
  // Body vs face (and eye/lip vs face) are different shelves: a face peel is never the answer to a
  // body-wash ad, however many acids they share (stage 3 review: body wash -> 32% face peel).
  const area = (f) => (["body", "hair", "eye", "lip"].includes(f) ? f : "face");
  if (comp.format && comp.format !== "other" && area(comp.format) !== area(sku.format)) {
    score -= 8;
    why.push(`different area (${area(comp.format)} vs ${area(sku.format)}) -8`);
  }
  if (shared.length) {
    // First shared active +6, each extra +2. +6 so the active outweighs format+function (+3 +2): for an
    // ingredient-led brand the active is what the ad sells (collagen/peptide cream -> peptide serum).
    const pts = 6 + 2 * Math.min(2, shared.length - 1);
    score += pts;
    why.push(`active ${shared.join("+")} +${pts}`);
    // concentration closeness on the first shared active
    const ca = (comp.actives || []).find((a) => familiesOf(a.name).includes(shared[0]));
    const sa = sku.actives.find((a) => familiesOf(a.name + " " + sku.title).includes(shared[0])) || sku.actives[0];
    const c = pctNum(ca?.pct), s = pctNum(sa?.pct);
    if (c && s) {
      if (c === s) { score += 1; why.push(`same ${sa.pct} +1`); }
      else if (Math.max(c, s) / Math.min(c, s) <= 2) { score += 0.5; why.push(`close % +0.5`); }
    }
  }
  // Same product function within an area: a body WASH should match a body wash, not a roll-on
  // (stage 3 review, second pass).
  const FUNC = /\b(wash|cleanser|lotion|cream|serum|mask|peel|gel|roll-?on|toner|oil|balm|mist|spray|scrub)\b/gi;
  const cfn = new Set((comp.name.match(FUNC) || []).map((x) => x.toLowerCase().replace("-", "")));
  const sfn = new Set((sku.title.match(FUNC) || []).map((x) => x.toLowerCase().replace("-", "")));
  const fn = [...cfn].filter((x) => sfn.has(x));
  if (fn.length) { score += 2; why.push(`same function (${fn[0]}) +2`); }
  // Texture is how shoppers tell sunscreens/moisturizers apart ("Lightweight Gel", "Oil-Free Aquagel"
  // vs "Light Fluid"). Without it, every sunscreen ad went to the #2 best seller (stage 3 review).
  const TEX = /\b(light(weight)?|fluid|gel|aqua\w*|water[- ]?(gel|based|light)|oil[- ]?free|matte|non[- ]?greasy)\b/i;
  if (TEX.test(comp.name) && TEX.test([sku.title, sku.tagline].join(" "))) { score += 1.5; why.push(`texture match +1.5`); }
  if (comp.format && comp.format === sku.format) { score += 3; why.push(`format ${sku.format} +3`); }
  else if (comp.format && (ADJACENT[comp.format] || []).includes(sku.format)) { score += 1; why.push(`format adjacent +1`); }
  const skuConcernText = [...sku.concerns, sku.tagline, sku.title].join(" ").toLowerCase();
  const concernHits = (comp.concerns || []).filter((c) => c && skuConcernText.includes(c.toLowerCase().replace(/s$/, ""))).slice(0, 3);
  if (concernHits.length) { score += concernHits.length; why.push(`concern ${concernHits.join(", ")} +${concernHits.length}`); }
  if (sku.best_seller_rank && sku.best_seller_rank <= 20) {
    const d = +((21 - sku.best_seller_rank) / 20).toFixed(2);
    score += d;
    why.push(`top seller #${sku.best_seller_rank} +${d}`);
  }
  return { score: +score.toFixed(2), why };
}

export function matchProduct(comp, { top = 3 } = {}) {
  const hairOk = comp.format === "hair";
  const ranked = DICT.skus
    .filter((s) => !s.pediatric && (hairOk || s.format !== "hair"))
    .map((s) => ({ sku: s, ...scoreSku(comp, s) }))
    .sort((a, b) => b.score - a.score || (b.sku.review_count ?? 0) - (a.sku.review_count ?? 0));
  const best = ranked[0];
  // Below 4 points nothing matched on active or format — only concern words / popularity. Say so.
  const confidence = best.score >= 8 ? "high" : best.score >= 4 ? "medium" : "low";
  return { best: best.sku, confidence, candidates: ranked.slice(0, top).map((r) => ({ handle: r.sku.handle, title: r.sku.title, score: r.score, why: r.why })) };
}

export const TOP_SELLERS = DICT.top_sellers;
