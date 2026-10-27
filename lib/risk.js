// Risk levels used across the pipeline instead of removing formats or blocking briefs (user decision 2026-10-03).
export const LEVELS = ["low", "medium", "high", "severe"];
export const LABEL = { low: "Low", medium: "Medium", high: "High", severe: "Severe" };
export const worst = (...ls) => LEVELS[Math.max(...ls.filter(Boolean).map((l) => LEVELS.indexOf(l)), 0)];

// What a template's image source implies when the real asset is missing (asset library has none).
export const SOURCE_RISK = {
  "PACK+BG": { level: "low", note: "Real pack shot composited on a generated background." },
  PACK: { level: "low", note: "Real pack shot only." },
  LAYOUT: { level: "low", note: "Type and graphics with the real pack shot." },
  MARKETER: { level: "medium", note: "Needs numbers/terms a marketer must supply and source (offer, sales count, prices)." },
  // User rule (2026-10-04): any model (AI person or hands) in a concept is Severe; such ads are kept for review.
  "REAL PHOTO:people": { level: "severe", note: "AI-generated model (person or hands): Severe by default (user rule 2026-10-04). Labelled as synthetic (ASCI SGC); kept for review, not exportable until a real, consented photo replaces it." },
  "REAL PHOTO:result": { level: "severe", note: "AI-generated skin/result/before-after: banned by ASCI's synthetic-content guideline even when labelled, and misleading under ASCI 1.4. Internal test only — replace with real, unretouched study photos before any publication." },
  "REAL PHOTO:product-detail": { level: "medium", note: "Generated texture/macro of the product misrepresents the formula; use a real macro photo." },
  "REAL PHOTO:endorser": { level: "severe", note: "Expert/creator/customer must be real and consenting; an AI version is a fabricated endorsement. Severe (a model is used; user rule 2026-10-04)." },
};

// Scorer verdict → risk level for a brief.
export function briefRisk(verdictCode, findings = []) {
  if (verdictCode === "BLOCKED") return "severe";
  if (findings.some((f) => f.severity === "fix" && f.dimension === "policy")) return "medium";
  if (verdictCode === "NEEDS_CHANGES") return "medium";
  return "low";
}
