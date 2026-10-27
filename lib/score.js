// Scorer: rule layer (always) + model layer (when a key is set) -> one report with a verdict.
// The verdict is computed here from findings — the model never picks it.
import { runRules, RULES, FIELDS, SEV_ORDER, sentenceAround } from "./rules.js";
import { judge, judgeAvailable, postProcessJudge } from "./judge.js";
import { structuredCall, loadPrompt } from "./llm.js";
import { applyDecisions, DECISIONS } from "./decisions.js";
import { scoreTiers } from "./tiers.js";

const DIMENSIONS = ["policy", "tone", "language"];

export function verdictFor(findings, coverage) {
  const worst = findings.reduce((w, f) => Math.max(w, SEV_ORDER.indexOf(f.severity)), -1);
  const limited = !coverage.model;
  if (worst === 2) {
    return { code: "BLOCKED", label: "Do not publish", detail: "At least one finding would put the ad at legal or brand risk. Export is disabled until it is fixed." };
  }
  if (worst === 1) {
    return { code: "NEEDS_CHANGES", label: "Fix before review", detail: "Change the flagged lines, or attach the substantiation a reviewer would need to accept them." };
  }
  return {
    // A rules-only pass gets its own code so the UI doesn't paint it green: "no regex hits" is not "looks safe".
    code: limited ? "LIMITED_CHECK" : "READY_FOR_REVIEW",
    label: limited ? "Ready for human review (limited check)" : "Ready for human review",
    detail: limited
      ? "No rule hits. The model layer did NOT run, so implied claims and overall tone were not assessed — the reviewer must read for those."
      : "No blocking or must-fix issues found. This is a pre-screen, not an approval: brand and legal sign-off is still required.",
  };
}

function summarize(findings) {
  const by = {};
  for (const d of DIMENSIONS) {
    const fs_ = findings.filter((f) => f.dimension === d);
    const worst = fs_.reduce((w, f) => Math.max(w, SEV_ORDER.indexOf(f.severity)), -1);
    by[d] = { count: fs_.length, worst: worst < 0 ? "clear" : SEV_ORDER[worst] };
  }
  return by;
}

function overlaps(a, b) {
  return a.field === b.field && a.start < b.end && b.start < a.end;
}

export async function scoreAd(adIn, ctx = {}) {
  const ad = { ad_type: "brand", ...adIn };
  for (const f of FIELDS) ad[f] = String(ad[f] ?? "");
  if (!FIELDS.some((f) => ad[f].trim())) throw new Error("Ad has no text to score.");

  const ruleFindings = runRules(ad, ctx);
  const coverage = { rules: true, model: false, model_error: null, rules_version: RULES.version, decisions_version: DECISIONS.version };
  let modelOut = null;

  if (ctx.injectModelData) {
    // Eval only: model output produced outside the API (see eval/README.md), validated by the same code.
    modelOut = postProcessJudge(ctx.injectModelData, ad, ruleFindings);
    coverage.model = true;
    coverage.model_name = ctx.injectModelName || "injected";
  } else if (judgeAvailable() && !ctx.rulesOnly) {
    try {
      modelOut = await judge(ad, ruleFindings, ctx);
      coverage.model = true;
      coverage.model_name = modelOut.model;
    } catch (e) {
      coverage.model_error = e.message;
    }
  }

  // Attach the model's false-positive opinions to rule hits (shown, never acted on).
  if (modelOut) {
    for (const r of modelOut.review) {
      if (r.assessment === "likely_false_positive") ruleFindings[r.index].model_comment = `Model thinks this may be a false positive: ${r.why}`;
    }
  }
  const modelFindings = modelOut ? modelOut.findings.filter((m) => !ruleFindings.some((r) => r.rule_id === m.rule_id && overlaps(r, m))) : [];
  // Brand / legal decisions (rules/brand_decisions.json: acne wording, taglines) apply to the judge's findings too.
  for (const m of modelFindings) {
    m.sentence = sentenceAround(ad[m.field], m.start, m.end);
    applyDecisions(m);
  }
  const findings = [...ruleFindings, ...modelFindings].sort(
    (a, b) => SEV_ORDER.indexOf(b.severity) - SEV_ORDER.indexOf(a.severity) || FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field) || a.start - b.start
  );

  const report = {
    verdict: verdictFor(findings, coverage),
    dimensions: summarize(findings),
    findings,
    tone_read: modelOut?.tone_read ?? null,
    language_read: modelOut?.language_read ?? null,
    coverage,
    dropped_model_findings: modelOut?.rejected ?? [],
    ad,
    scored_at: new Date().toISOString(),
  };
  // Three scores (lib/tiers.js): alignment, win, compliance. Computed from the finished report, so they can't change
  // the verdict; compliance is derived from it.
  report.scores = scoreTiers(report, ctx);
  return report;
}

// Image ads: the model transcribes the text it can see (a separate, narrow task), the marketer
// can correct the transcript, and the transcript is scored like any pasted ad.
const TRANSCRIBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "on_image_text", "footnote", "cta", "illegible_parts", "visual_notes"],
  properties: {
    headline: { type: "string" },
    on_image_text: { type: "string" },
    footnote: { type: "string" },
    cta: { type: "string" },
    illegible_parts: { type: "string" },
    visual_notes: { type: "string" },
  },
};

export async function transcribeImageAd(base64, mediaType = "image/png") {
  if (!judgeAvailable()) throw new Error("Image ads need ANTHROPIC_API_KEY (the model reads the text off the image). Paste the ad text instead.");
  const { data } = await structuredCall({
    system: loadPrompt("transcribe_system.md"),
    user: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "Transcribe this ad creative." },
    ],
    schema: TRANSCRIBE_SCHEMA,
    effort: "low",
  });
  return data;
}

export async function scoreImageAd(base64, mediaType) {
  const t = await transcribeImageAd(base64, mediaType);
  const report = await scoreAd({ headline: t.headline, on_image_text: t.on_image_text, footnote: t.footnote, cta: t.cta, primary_text: "" });
  report.transcript = t;
  return report;
}
