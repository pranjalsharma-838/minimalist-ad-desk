// Checks an image-generation prompt BEFORE it goes to an image model.
// The image model is only ever allowed to make an empty background: the real pack shot and the
// compliance-checked copy are composited on top by our renderer. So anything that would make the
// model draw the product, text, skin/faces, results or endorsement cues is a block.
//   - product / packaging / label: a generated bottle is a fabricated depiction of a real product
//   - text / logos: rendered copy would bypass the copy checks (and models misspell)
//   - skin, faces, before/after, results: ASCI synthetic-content guideline (Sept 2026) bans AI-made results
//   - doctors, lab coats, badges, seals: imply an endorsement or certification nobody gave
const ASK = String.raw`(show|showing|with|featuring|include|including|depict|depicting|of an?|a|an|the)\s+`;
const BLOCKS = [
  ["product", new RegExp(String.raw`\b${ASK}(\w+\s+){0,3}(product|bottle|dropper|tube|jar|packaging|pack\s?shot|serum\s+bottle|label)\b`, "i"), "Asks the model to draw the product or packaging. Use the real pack shot (composited by the tool)."],
  ["text", new RegExp(String.raw`\b${ASK}(\w+\s+){0,2}(text|headline|words|letters|typography|caption|logo|brand name|price)\b`, "i"), "Asks for text or logos in the image. All copy is placed by the tool after compliance checks."],
  ["skin_people", new RegExp(String.raw`\b${ASK}(\w+\s+){0,3}(face|faces|skin|woman|women|man|men|model|person|people|hands?|cheek|complexion)\b`, "i"), "Asks for people or skin. Generated skin can imply results (banned for AI imagery under ASCI's 2026 guideline)."],
  ["before_after", /\b(before\s*(\/|&|and|-)\s*after|transformation|results?\s+(photo|image|shot)|clear(er)?\s+skin|flawless|glowing\s+skin|poreless)\b/i, "Asks for before/after or result imagery. Only real, unretouched study photos may show results."],
  ["endorsement", /\b(doctor|dermatologist|lab\s+coat|stethoscope|clinic|badge|seal|certificate|award|approved\s+stamp)\b/i, "Implies an endorsement or certification."],
];
// A prompt that says "no product, no text, no people…" is the desired shape — negations are not asks.
// The negation must sit IMMEDIATELY before the match ("without a bottle"); a "no" earlier in the
// sentence doesn't excuse a later ask ("No text, but show the serum bottle" is still a block).
const NEGATED = /\b(no|without|not|never|avoid|exclude|excluding|free of|leave out)\s*$/i;
// Per-finding risk level. "product" is the only refusal (we never fabricate the pack).
const LEVEL = { product: "severe", text: "high", skin_people: "high", before_after: "severe", endorsement: "high" };
const ORDER = ["low", "medium", "high", "severe"];
const worst = (...ls) => ORDER[Math.max(...ls.map((l) => ORDER.indexOf(l)))];

export function checkImagePrompt(prompt) {
  const findings = [];
  const sentences = String(prompt || "").split(/(?<=[.;\n])\s*/);
  for (const s of sentences) {
    for (const [id, re, why] of BLOCKS) {
      const m = s.match(re);
      if (!m) continue;
      if (NEGATED.test(s.slice(Math.max(0, m.index - 20), m.index))) continue;
      // Reserving space for the real pack shot is the desired shape, not an ask to draw one:
      // "empty space reserved on the plinth for a product photo to be placed later" (first gate run).
      if (id === "product") {
        const around = s.slice(Math.max(0, m.index - 10), m.index + m[0].length + 60);
        if (/\bfor\s+(a|the)\s+(\w+\s+)?product\b/i.test(around) && /\b(placed|added|composited|overlaid|inserted)\b|\blater\b|\bto be\b/i.test(around)) continue;
      }
      // Same for copy: "keep the top band calm and low-detail for the headline" reserves space (format run).
      if (id === "text") {
        const before = s.slice(Math.max(0, m.index - 70), m.index + m[0].length);
        if (/\bfor\s+(a|the)\s+(\w+\s+)?(headline|copy|text|title|label)s?\s*$/i.test(before) && /\b(space|area|band|calm|plain|empty|reserved|low-detail|clear|stays)\b/i.test(before)) continue;
      }
      findings.push({ id, span: m[0], sentence: s.trim(), why, level: LEVEL[id] });
    }
  }
  const missing = [];
  if (!/\bno\s+(text|words|letters)\b|\bwithout\s+(any\s+)?text\b|do not include:[^.]*\btext\b/i.test(prompt)) missing.push("say 'no text, no letters, no logos'");
  if (!/\bno\s+(product|bottle|packaging)\b|\bwithout\s+(any\s+)?(product|bottle)\b|do not include:[^.]*\b(product|bottle)\b/i.test(prompt)) missing.push("say 'no product, no bottle, no packaging'");
  if (!/\b(empty|clear|negative)\s+(space|area|zone)\b|intentionally empty/i.test(prompt)) missing.push("reserve empty space for the product photo and copy");
  // Risk-level model (user decision 2026-10-03): only drawing the product is refused outright; people,
  // skin, results and endorsement cues are allowed with a risk level and the AI-generated label.
  const refused = findings.some((f) => f.id === "product");
  const risk = worst(...findings.map((f) => f.level), missing.length ? "medium" : "low");
  return {
    ok: findings.length === 0 && missing.length === 0,
    refused,
    blocked: refused, // kept for older callers: only the product case blocks now
    risk,
    ai_label_required: findings.some((f) => ["skin_people", "before_after"].includes(f.id)),
    findings,
    missing,
  };
}
