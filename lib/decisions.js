// Brand / legal answers to the rulebook's open questions (rules/brand_decisions.json).
// A decided finding is kept on the report, lowered to the decision's severity and labelled with the decision id;
// it is never removed. Used by the rule layer (lib/rules.js) and on model findings (lib/score.js).
import fs from "node:fs";

export const DECISIONS = JSON.parse(fs.readFileSync(new URL("../rules/brand_decisions.json", import.meta.url), "utf8"));

const ACTIVE = DECISIONS.decisions
  .filter((d) => d.match && d.effect && d.effect !== "none")
  .map((d) => ({
    d,
    rules: d.match.rules ? new Set(d.match.rules) : null,
    exact: d.match.exact_span ? new Set(d.match.exact_span) : null,
    span: d.match.span ? new RegExp(d.match.span, "iu") : null,
    unless: d.match.unless ? new RegExp(d.match.unless, "iu") : null,
  }));

export function applyDecisions(f) {
  const span = String(f.span || "").trim();
  for (const a of ACTIVE) {
    if (a.rules && !a.rules.has(f.rule_id)) continue;
    if (a.d.match.layer && a.d.match.layer !== f.layer) continue;
    if (a.exact && !a.exact.has(span.toLowerCase())) continue;
    if (a.span && !a.span.test(span)) continue;
    // The whole sentence counts: "reduces acne for good" keeps its flag even though the hit is only "reduces acne".
    if (a.unless && (a.unless.test(span) || a.unless.test(f.sentence || ""))) continue;
    f.severity = a.d.effect;
    f.decision = a.d.id;
    f.note = a.d.note;
    break;
  }
  return f;
}

// Reviewer labels written before a decision existed, adjusted for it (the labels file itself is never edited).
export function relabel(labels) {
  const changes = DECISIONS.decisions.flatMap((d) => (d.eval_relabels || []).map((r) => ({ ...r, decision: d.id })));
  let applied = 0;
  const out = labels.map((l) => {
    const mine = changes.filter((c) => c.id === l.id);
    if (!mine.length) return l;
    return {
      ...l,
      issues: l.issues.map((i) => {
        const c = mine.find((x) => x.phrase === i.phrase && x.from === i.level);
        if (!c) return i;
        applied++;
        return { ...i, level: c.to, relabelled_by: c.decision };
      }),
    };
  });
  return { labels: out, applied, total: changes.length };
}
