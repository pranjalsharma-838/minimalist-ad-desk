// "Write it with AI" for a format's missing lines (badges, callouts, this vs that, old way / new way, us vs them, FAQ
// answer). The model must cite page facts; code then checks every line exactly like a library brief (lib/brief_check.js
// checkBrief: ids exist, are citable, every number is in the cited facts). Lines that fail are dropped and reported,
// never kept. One retry with the problems, never more.
import { structuredCall, loadPrompt, llmAvailable } from "./llm.js";
import { checkBrief } from "./brief_check.js";
import { buildFormat } from "./app_formats.js";

const GUIDE = {
  badges: "Two badges for a 'product + benefit badges' ad: each 2 to 6 words, a single benefit or feature the page states.",
  callouts: "Two callouts pointing at the pack: each a short page fact, up to 60 characters.",
  thisvsthat: "Two approaches side by side. Left (a_title, a1, a2): another way people go about the same need, e.g. a habit or a type of product the page itself mentions — never a brand. Right (b_title, b1, b2): this product's approach, from the page.",
  oldnew: "Old way vs new way. Old items: a habit or routine the page's facts describe or imply is replaced (never a brand, never a product). New items: what this product does, from the page.",
  usvsthem: "A like-for-like comparison. 'them' must be an unnamed benchmark, ingredient or product type that the page itself names. Each row compares one measurable thing, both sides from the cited facts. 'basis' says what was compared, how and the source, as the page states it. If the page has no such comparison, leave every line empty.",
  faq: "Answer the FAQ question with one short product-page fact (not the FAQ's own answer), up to 110 characters.",
};
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["lines"],
  properties: { lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "text", "cites"], properties: { key: { type: "string" }, text: { type: "string" }, cites: { type: "array", items: { type: "string" } } } } } },
};

export async function draftLines(format, copy, sheet, inputs = {}) {
  if (!llmAvailable()) throw new Error("Writing lines with AI needs a Claude API key (top right). You can type them instead.");
  if (!GUIDE[format]) throw new Error("This format has nothing for the AI to write.");
  const b = buildFormat(format, copy, sheet, inputs);
  if (b.notFit) throw new Error(b.notFit);
  const fields = b.meta.fields.filter((f) => !f.options && f.key !== "us");
  const facts = sheet.facts.filter((f) => !["inci", "price", "offer", "rating", "review"].includes(f.kind)).map((f) => `${f.id} [${f.kind}] (${f.section}) ${f.text}`).join("\n");
  const ask = (revision) => structuredCall({
    system: loadPrompt("app_format_draft.md"),
    user: `Product: ${sheet.title}\nFormat: ${b.meta.label}. ${GUIDE[format]}\n${format === "faq" ? `Question: ${b.brief.faq?.question}\n` : ""}Ad headline (already written): ${copy.headline}\n\nFields to fill:\n${fields.map((f) => `- ${f.key}: ${f.label}${f.max ? ` (max ${f.max} characters)` : ""}`).join("\n")}\n\nProduct facts:\n${facts}\n${revision ? `\nYour previous lines failed these checks; fix or drop them:\n${revision}\n` : ""}`,
    schema: SCHEMA, effort: "low", maxTokens: 4000,
  });
  const check = (lines) => {
    const ok = {}, cites = {}, problems = [];
    for (const l of lines) {
      const f = fields.find((x) => x.key === l.key);
      const text = String(l.text || "").trim();
      if (!f || !text) continue;
      if (f.max && text.length > f.max) { problems.push(`${l.key}: ${text.length} characters (max ${f.max})`); continue; }
      if (/_title$/.test(l.key) && !l.cites?.length) { ok[l.key] = text; continue; }
      const p = checkBrief({ layout: "hero", headline: text, citations: { headline: l.cites || [] } }, { _main: sheet }, "_main").map((x) => x.replace(/^headline/, l.key));
      if (p.length) problems.push(...p);
      else { ok[l.key] = text; cites[l.key] = l.cites; }
    }
    return { values: ok, cites, problems };
  };
  let out = check((await ask()).data.lines);
  if (out.problems.length) {
    const second = check((await ask(out.problems.map((p) => `- ${p}`).join("\n"))).data.lines);
    out = { values: { ...out.values, ...second.values }, cites: { ...out.cites, ...second.cites }, problems: second.problems };
  }
  return out;
}
