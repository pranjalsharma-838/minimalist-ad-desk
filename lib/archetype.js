// Archetype selection (layer 4). Ranks ALL 48 templates for a request and returns a shortlist.
// Nothing is removed: a template that needs assets we lack still ranks on merit, and carries a risk
// level + suggestion instead (user decision 2026-10-03).
//
// Score (each part 0..1, weights below; every part is explained in the output "why"):
//   winners   — competitor ads running 30+ days in this template's format, more weight if same category
//   trends    — trend file signal for the format (0 until the trend agent exists; said so in "why")
//   facts     — share of the template's needed fact kinds the product page actually has
//   objective — fit between the request's objective and the template family
// Diversity: at most 2 picks per family in the shortlist.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_RISK, LABEL, worst } from "./risk.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const readJson = (p, d = null) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const TEMPLATES = readJson(path.join(root, "config", "templates.json")).templates;
const W = { winners: 0.45, trends: 0.15, facts: 0.25, objective: 0.15 };
const WINNER_DAYS = 30;

const OBJECTIVE_FIT = {
  sales: { Commercial: 1, Proof: 0.9, Product: 0.8, "Human + Product": 0.7, Transformation: 0.7, Education: 0.5, Comparison: 0.6, Problem: 0.6, Result: 0.6, "Native social": 0.5 },
  awareness: { Product: 0.9, "Native social": 1, Result: 0.8, "Human + Product": 0.8, Education: 0.7, Problem: 0.6, Transformation: 0.6, Proof: 0.6, Comparison: 0.5, Commercial: 0.3 },
  education: { Education: 1, Comparison: 0.9, Problem: 0.8, Proof: 0.8, Product: 0.6, Transformation: 0.6, "Native social": 0.6, "Human + Product": 0.5, Result: 0.4, Commercial: 0.2 },
};

function loadWinners() {
  const ads = [];
  for (const dir of ["research/competitor_ads_deep", "research/competitor_ads"]) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((f) => f.endsWith(".json"))) {
      for (const a of readJson(path.join(d, f), [])) if (!a.duplicate_of) ads.push({ ...a, _src: dir });
    }
  }
  const seen = new Set();
  // Statics only (user rule 2026-10-04: "from meta we were supposed to scrape statics and not videos, for competitor
  // as well as ours"): we make static ads, so only image and carousel (static cards) ads count as evidence.
  return ads.filter((a) => a.ad_type && a.format !== "video" && (a.days_running || 0) >= WINNER_DAYS && !seen.has(a.id) && seen.add(a.id));
}

// Generic words would make every skincare ad "same category" (first test: 12 of 14 offer ads matched
// niacinamide via "skin"/"face"). Only concern/ingredient words count.
const GENERIC = new Set("skin face serum cream care with your that this from more less glow glowing best type types oily dry normal all sensitive acne prone suitable years combination daily skincare product products formula".split(" "));
const words = (s) => new Set((String(s || "").toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !GENERIC.has(w)));

// request: { product_handle, sheet, audience, placement, objective, top }
export function rankArchetypes(request) {
  const winners = loadWinners();
  const trends = readJson(path.join(root, "research", "trends.json"));
  const ownResults = readJson(path.join(root, "research", "own_results.json"));
  const assets = readJson(path.join(root, "brand_packs", "minimalist", "assets", "index.json"), { assets: [] }).assets;
  const sheet = request.sheet;
  const kinds = new Set(sheet.facts.map((f) => f.kind));
  if (sheet.facts.some((f) => /rating|reviews?\b/i.test(f.text)) || sheet.rating) kinds.add("rating");
  const productWords = words(`${sheet.title} ${sheet.facts.filter((f) => f.kind === "suitability").map((f) => f.text).join(" ")}`);
  const objective = OBJECTIVE_FIT[request.objective] ? request.objective : "sales";

  // Template-level winner tags (research/winners.json, from the winner agent) replace the coarse ad_type
  // mapping when present: primary match counts 1, secondary 0.5.
  const tagged = readJson(path.join(root, "research", "winners.json"));
  const byId = new Map((tagged?.ads || []).map((a) => [String(a.id), a]));
  const matchesTemplate = (a, t) => {
    const w = byId.get(String(a.id));
    if (w) return w.template_id === t.id || (w.secondary_template_ids || []).includes(t.id);
    return t.competitor_types.includes(a.ad_type);
  };
  const weight = (a, t) => (byId.get(String(a.id))?.template_id === t.id || !byId.has(String(a.id)) ? 1 : 0.5);
  const maxW = Math.max(1, ...TEMPLATES.map((t) => winners.filter((a) => matchesTemplate(a, t)).reduce((s, a) => s + weight(a, t), 0)));
  const rows = TEMPLATES.map((t) => {
    const matching = winners.filter((a) => matchesTemplate(a, t));
    const sameCat = matching.filter((a) => [...words(`${a.headline} ${a.primary_text} ${a.on_image_text}`)].some((w) => productWords.has(w)));
    const wsum = matching.reduce((s, a) => s + weight(a, t), 0);
    const winnersScore = Math.min(1, (wsum + 2 * sameCat.reduce((s, a) => s + weight(a, t), 0)) / (maxW * 1.5));
    const trend = trends?.formats?.[t.id] ?? trends?.ad_types?.[t.competitor_types[0]];
    const trendScore = typeof trend === "number" ? trend : 0;
    // Generic templates (no product-specific facts needed) get 0.6, so formats that use this product's own facts win ties (2026-10-03).
    const factsScore = t.needs.length ? t.needs.filter((k) => kinds.has(k)).length / t.needs.length : 0.6;
    // Library variety: in a multi-product run, each earlier pick of this format costs 0.12 (never excluded).
    const usedBefore = request.used?.[t.id] || 0;
    const objScore = OBJECTIVE_FIT[objective][t.family] ?? 0.5;
    // Add-on (c): our OWN results (research/own_results.json, scripts/results_ingest.js) override competitor
    // evidence as they arrive — 35% of the score for a format with enough data (>= 3,000 impressions), else 0.
    const own = ownResults?.template?.[t.id];
    const ownW = own && own.score != null ? 0.35 : 0;
    const base = W.winners * winnersScore + W.trends * trendScore + W.facts * factsScore + W.objective * objScore;
    const score = (1 - ownW) * base + ownW * (own?.score || 0) - 0.12 * usedBefore;

    const ownAsset = assets.find((a) => a.type === t.asset_type && (a.product_handle === request.product_handle || a.product_handle === "*"));
    let risk;
    // Bug fix (2026-10-03): a pack shot in the library made MARKETER formats (price comparison) "Low";
    // the missing marketer data is the risk there, not the photo.
    if (t.source === "MARKETER") risk = SOURCE_RISK.MARKETER;
    else if (ownAsset) risk = { level: t.source.startsWith("REAL PHOTO:result") ? "medium" : "low", note: `Real asset available in the library (${ownAsset.file}). ${t.source.startsWith("REAL PHOTO:result") ? "Result imagery still needs the study it comes from on file." : ""}`.trim() };
    else risk = SOURCE_RISK[t.source] || { level: "medium", note: "Unknown source type." };
    // Formats whose CLAIM is the risk carry a floor from config/templates.json (Us vs Them, 2026-10-04): a real pack
    // shot makes the image safe, not the comparison.
    if (t.claim_risk && worst(risk.level, t.claim_risk) !== risk.level) risk = { level: t.claim_risk, note: t.claim_risk_note };
    const aiLabel = !ownAsset && t.source.startsWith("REAL PHOTO:") && ["REAL PHOTO:people", "REAL PHOTO:result", "REAL PHOTO:endorser"].includes(t.source);
    const missingFacts = t.needs.filter((k) => !kinds.has(k));

    const why = [
      `${matching.length} competitor ads 30+ days in this format${sameCat.length ? ` (${sameCat.length} in this category)` : ""}`,
      trends ? `trend signal ${trendScore.toFixed(2)}` : "no trend file yet",
      missingFacts.length ? `product page lacks: ${missingFacts.join(", ")}` : "product page has the facts it needs",
      ownW ? `OUR results: ${own.basis.toUpperCase()} score ${own.score} over ${own.ads} ad(s), ${own.impressions.toLocaleString("en-IN")} impressions (35% of score)` : "no own results yet for this format",
      ...(usedBefore ? [`already picked for ${usedBefore} earlier product(s) in this run (variety penalty)`] : []),
      `${t.family} fits a ${objective} objective ${objScore >= 0.8 ? "well" : objScore >= 0.6 ? "moderately" : "weakly"}`,
    ];
    const suggestions = [];
    if (!ownAsset && t.source.startsWith("REAL PHOTO")) suggestions.push(`Real ${t.asset_type.replace(/_/g, " ")} photos would lower the risk (none in the asset library for this SKU).`);
    if (aiLabel) suggestions.push('Any AI-generated person/skin/result must carry the visible "AI-GENERATED — ILLUSTRATIVE" mark.');
    if (t.layout === "new") suggestions.push("Renderer layout not built yet: the brief will describe the layout for a designer.");
    if (missingFacts.length) suggestions.push(`Missing facts (${missingFacts.join(", ")}): the brief must leave those slots as [placeholders] — no invention.`);
    if (t.source === "MARKETER") suggestions.push("Offer terms / numbers must come from the marketer with a source and date.");

    return {
      id: t.id, name: t.name, family: t.family, layout: t.layout, source: t.source,
      score: +score.toFixed(3), parts: { winners: +winnersScore.toFixed(2), trends: +trendScore.toFixed(2), facts: +factsScore.toFixed(2), objective: objScore },
      risk: risk.level, risk_label: LABEL[risk.level], risk_note: risk.note, ai_label_required: aiLabel,
      why: why.join("; "), suggestions,
      example_winners: matching.sort((a, b) => b.days_running - a.days_running).slice(0, 3).map((a) => `${a.brand} · ${a.days_running}d · ${a.id}`),
    };
  }).sort((a, b) => b.score - a.score);

  const top = request.top || 4;
  const perFamily = {};
  const shortlist = [];
  for (const r of rows) {
    if (shortlist.length >= top) break;
    if ((perFamily[r.family] || 0) >= 2) continue;
    perFamily[r.family] = (perFamily[r.family] || 0) + 1;
    shortlist.push(r);
  }
  return {
    request: { product_handle: request.product_handle, product: sheet.title, audience: request.audience || "", placement: request.placement || "feed 1:1", objective },
    inputs: { winners_30d: winners.length, winner_tags: tagged ? "template-level (research/winners.json)" : "coarse ad_type mapping", winner_sources: [...new Set(winners.map((a) => a._src))], trend_file: Boolean(trends), assets: assets.length },
    shortlist,
    full_ranking: rows,
  };
}
