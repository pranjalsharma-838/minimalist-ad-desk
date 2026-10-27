// Model judgment layer for the scorer. The model is given the rulebook and the rule-layer hits,
// and may (a) add findings the regexes can't see — implied claims, fear framing, tone — and
// (b) comment on whether a rule hit looks like a false positive.
// It may NOT remove or downgrade a rule hit, and it does NOT set severity for listed rules:
// severity comes from the rulebook. Everything it returns is validated against the ad text.
import { RULES, RULE_INDEX, FIELDS } from "./rules.js";
import { structuredCall, loadPrompt, llmAvailable } from "./llm.js";

export const judgeAvailable = llmAvailable;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "rule_hit_review", "tone_read", "language_read"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rule_id", "dimension", "field", "span", "severity", "why", "fix"],
        properties: {
          rule_id: { type: "string" },
          dimension: { type: "string", enum: ["policy", "tone", "language"] },
          field: { type: "string", enum: FIELDS },
          span: { type: "string" },
          severity: { type: "string", enum: ["block", "fix", "advisory"] },
          why: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
    rule_hit_review: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "assessment", "why"],
        properties: {
          index: { type: "integer" },
          assessment: { type: "string", enum: ["agree", "likely_false_positive"] },
          why: { type: "string" },
        },
      },
    },
    tone_read: { type: "string" },
    language_read: { type: "string" },
  },
};

export function renderRulebook() {
  return RULES.rules
    .map((r) => {
      const ex = r.examples ? `\n  fails: ${(r.examples.fail || []).map((x) => JSON.stringify(x)).join("; ")}\n  passes: ${(r.examples.pass || []).map((x) => JSON.stringify(x)).join("; ")}` : "";
      return `- ${r.id} [${r.dimension} / ${r.severity}] ${r.title}\n  why: ${r.rationale}\n  look for: ${r.judge_hint || r.message}${ex}`;
    })
    .join("\n");
}

function adBlock(ad) {
  return FIELDS.filter((f) => (ad[f] || "").trim())
    .map((f) => `<${f}>\n${ad[f]}\n</${f}>`)
    .join("\n");
}

// Locate the model's quoted span in the ad. Exact first, then whitespace/case-insensitive.
function locate(ad, field, span) {
  const text = ad[field] || "";
  if (!span) return null;
  let i = text.indexOf(span);
  if (i >= 0) return { start: i, end: i + span.length };
  const squash = (s) => s.toLowerCase().replace(/\s+/g, " ");
  const t = squash(text), s = squash(span.trim());
  i = t.indexOf(s);
  if (i < 0) return null;
  // map squashed index back (approximate: same-length when only whitespace differs)
  return { start: i, end: i + s.length, approx: true };
}

// Exposed separately so the eval harness can render the exact prompt the API would receive.
export function buildJudgePrompt(ad, ruleFindings, ctx = {}) {
  const system = loadPrompt("scorer_system.md", { RULEBOOK: renderRulebook(), RULES_VERSION: RULES.version });
  const hits = ruleFindings.map((f, i) => `${i}. ${f.rule_id} in ${f.field}: "${f.span}"`).join("\n") || "(none)";
  const facts = ctx.sheet
    ? ctx.sheet.facts.filter((f) => f.kind !== "inci").map((f) => `${f.id} [${f.kind}] ${f.text}`).join("\n")
    : "(no product page attached — judge claims on the ad alone)";
  const user = loadPrompt("scorer_user.md", {
    AD_TYPE: ad.ad_type === "creator" ? "creator / paid-partnership (creator's own voice)" : "brand-authored",
    AD: adBlock(ad),
    RULE_HITS: hits,
    PRODUCT_FACTS: facts,
  });
  return { system, user, schema: SCHEMA };
}

export async function judge(ad, ruleFindings, ctx = {}) {
  const { system, user } = buildJudgePrompt(ad, ruleFindings, ctx);
  const { data, usage, model } = await structuredCall({ system, user, schema: SCHEMA, effort: "high" });
  return { ...postProcessJudge(data, ad, ruleFindings), usage, model };
}

// Validation of the model's output — identical whether the output came from the API or the eval's stand-in.
export function postProcessJudge(data, ad, ruleFindings) {
  const accepted = [];
  const rejected = [];
  for (const f of data.findings) {
    const rule = RULE_INDEX.get(f.rule_id);
    if (!rule && f.rule_id !== "UNLISTED") {
      rejected.push({ ...f, reason: "rule_id not in rulebook" });
      continue;
    }
    const loc = locate(ad, f.field, f.span);
    if (!loc) {
      rejected.push({ ...f, reason: "quoted span not found in the ad" });
      continue;
    }
    // Deterministic checks (SPF / concentration matching) are code-only: the stand-in eval showed the
    // model raising CLM-19 on a guess ("no product page attached"), which would hard-block on no evidence.
    if (rule && rule.computed) {
      rejected.push({ ...f, reason: "deterministic check — only the rule layer may raise it" });
      continue;
    }
    // Severity: the milder of the model's view and the rulebook's. The rulebook caps how hard a model
    // finding can hit; the model can read a case as milder (e.g. "#ad present but buried" vs "missing").
    // Rule-layer hits are untouched, so this can't weaken a deterministic finding.
    // The judge enforces the rulebook only (user, 2026-10-05: "it should strictly stick to rules and never its own
    // judgement"). An UNLISTED concern is kept as an advisory note for the reviewer and never changes the verdict.
    const ORDER = ["advisory", "fix", "block"];
    const severity = rule
      ? ORDER[Math.min(ORDER.indexOf(rule.severity), ORDER.indexOf(f.severity))]
      : "advisory";
    accepted.push({
      rule_id: f.rule_id,
      dimension: rule ? rule.dimension : f.dimension,
      severity,
      title: rule ? rule.title : "Reviewer judgment (not in rulebook)",
      field: f.field,
      start: loc.start,
      end: loc.end,
      span: (ad[f.field] || "").slice(loc.start, loc.end),
      message: f.why,
      fix: f.fix,
      sources: rule ? rule.sources : [],
      confidence: rule ? rule.confidence : "model-opinion",
      layer: "model",
    });
  }
  const review = (data.rule_hit_review || []).filter((r) => r.index >= 0 && r.index < ruleFindings.length);
  return { findings: accepted, rejected, review, tone_read: data.tone_read, language_read: data.language_read };
}
