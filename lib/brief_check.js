// Checks and converts briefs of ANY format (research/ad_format_library.md).
// Every printed line must cite facts; a citation is "F3" (the brief's main product) or
// "<handle>:F3" (another of our products, used in journey / range layouts). Each number in a line must
// appear in the cited facts or in the cited product's title. Offer terms are the one exception: they
// come from the marketer, not a product page, so they're marked unverified instead of cited.
import { SIGN_OFF } from "../public/render.js";

const NOT_CITABLE = new Set(["testimonial", "faq", "inci"]);
// Minimalist's own taglines: "Hide Nothing." (logo sign-off on its Amazon brand slate and video end cards) and "Skin
// Science" (under the logo on its newer packs). Usable as a tag without a product-page citation (user, 2026-10-04).
export const BRAND_LINES = new Set(["hide nothing.", "hide nothing", "skin science"]);
// Numbers glued to a letter or hyphen are ingredient codes, not claims: "Oligopeptide-10", "Vitamin B5",
// "Q10" (format run: "Oligopeptide-10" was flagged as an uncited number).
// (lookbehind also excludes digits/dots, else "Oligopeptide-10" yields a stray "0" — caught by its test)
const nums = (s) => (String(s ?? "").match(/(?<![A-Za-z\-\d.])\d+(?:\.\d+)?(?![A-Za-z\d])/g) || []).map((n) => n.replace(/^0+(?=\d)/, ""));
export const LAYOUTS = ["hero", "actives", "journey", "stat", "callouts", "spec", "range", "offer", "before_after", "badges", "oldnew", "thisvsthat", "usvsthem", "review", "socialproof", "faq", "question", "native", "pricecompare", "timeline", "splitscreen", "texture"];

// House look from Minimalist's own top-running Meta ads (brand_packs/minimalist/ad_style_top_runners.md; user
// review 2026-10-03: "too text heavy"): very little text on the image, details in the caption. leanBrief()
// derives that split for ANY brief, so existing briefs follow the standard without being rewritten, and the
// compliance re-check (adFromBrief) sees exactly what the creative shows and what the caption says.
// Footnote sentences the law needs on the creative stay; ratings, sourcing and capture dates move to the caption.
// Eye-check fix (2026-10-04): the basis of a comparison, "results may vary" and perception qualifiers were not in this
// list, so two Us vs Them ads lost their basis line to the caption. Those stay on the creative.
const FOOT_KEEP = /T&C|free|condition|offer valid|stud(y|ies)|subjects|SPF|lab|in-vivo|ISO|AI illustration|illustrations?|not real|reappl|compar|benchmark|\bvs\b|versus|unlike|basis|ingredient form|results? (may )?vary|individual results|perception|self-reported/i;
const FOOT_MOVE = /out of 5 stars|reviews on|captured \d{4}|Ratings? from|Offers? as on/i;
export function leanBrief(b) {
  if (!b || b._lean) return b;
  const caption = [];
  // Every moved line ends as a sentence (judge, 2026-10-04: moved lines ran together and read as a garbled repeat).
  const push0 = caption.push.bind(caption);
  caption.push = (...xs) => push0(...xs.map((s) => String(s || "").trim()).filter(Boolean).map((s) => (/[.!?…)"”]$/.test(s) ? s : `${s}.`)));
  if (b.caption) caption.push(b.caption);
  let subhead = b.subhead || "";
  // On an offer the offer line is the title and its condition the supporting line; any subhead (how-to, benefit or a
  // price — the brand's statics show no prices) goes to the caption. Elsewhere the supporting line is ≤ 8 words.
  const offer = ["offer", "pricecompare"].includes(b.layout);
  if (offer && b.offer?.line && b.headline) caption.push(b.headline); // not drawn: the offer line is the title
  if (subhead && (offer || subhead.length > 60 || subhead.split(/\s+/).length > 8)) { caption.push(subhead); subhead = ""; }
  // Routine steps keep their label and pack shot; what each step does moves to the caption.
  const steps = b.layout === "journey" ? (b.steps || []).map((st) => { if (st.line) caption.push(`${st.label || ""}: ${st.line}`.replace(/^: /, "")); return { ...st, line: "" }; }) : b.steps;
  (b.proof_points || []).forEach((p) => caption.push(p));
  const keep = [], move = [];
  // A comparison's footnote is its basis (ASCI Chapter IV): on a Us vs Them ad the whole footnote stays on the creative.
  for (const s of String(b.footnote || "").split(/(?<=[.!?])\s+/).filter(Boolean)) (b.layout !== "usvsthem" && ((FOOT_MOVE.test(s) && !/T&C|free|condition/i.test(s)) || !FOOT_KEEP.test(s)) ? move : keep).push(s);
  caption.push(...move);
  const cap = (arr, n, txt) => { (arr || []).slice(n).forEach((x) => caption.push(txt(x))); return (arr || []).slice(0, n); };
  return {
    ...b, _lean: true, subhead, steps, proof_points: [], footnote: keep.join(" "),
    compare: b.compare ? { ...b.compare, rows: cap(b.compare.rows, 3, (r) => `${r.label}: ${r.us} vs ${r.them}`) } : b.compare,
    // Actives show as a big % and the name (the brand's statics); what each one does is caption copy.
    actives: cap(b.actives, 2, (a) => `${a.pct || ""} ${a.name}: ${a.line}`.trim()).map((a) => { if (a.line) caption.push(`${a.pct || ""} ${a.name}: ${a.line}`.trim()); return { ...a, line: "" }; }),
    callouts: cap(b.callouts, 2, (x) => x.text), badges: cap(b.badges, 3, (x) => x.text), specs: cap(b.specs, 3, (x) => `${x.label}: ${x.value}`),
    caption: caption.join(" ").replace(/\s+/g, " ").trim(),
  };
}

// Every printed line of a brief, with its citations, in reading order.
export function briefLines(b) {
  const L = [];
  const add = (label, text, cites) => text && String(text).trim() && L.push({ label, text: String(text), cites: cites || [] });
  const c = b.citations || {};
  add("headline", b.headline, c.headline);
  add("subhead", b.subhead, c.subhead);
  // The black tag is printed on the creative, so it is checked and scored like any other line (it had been skipped).
  add("tag", b.tag, c.tag);
  (b.proof_points || []).forEach((p, i) => add(`proof point ${i + 1}`, p, (c.proof_points || [])[i]));
  (b.actives || []).forEach((a, i) => add(`active ${i + 1}`, `${a.pct || ""} ${a.name} ${a.line}`.trim(), a.cites));
  (b.steps || []).forEach((s, i) => add(`step ${i + 1}`, `${s.label || ""} ${s.line}`.trim(), s.cites));
  if (b.stat) add("stat", `${b.stat.value} ${b.stat.label}`, b.stat.cites);
  (b.callouts || []).forEach((x, i) => add(`callout ${i + 1}`, x.text, x.cites));
  (b.specs || []).forEach((x, i) => add(`spec ${i + 1}`, `${x.label}: ${x.value}`, x.cites));
  (b.range || []).forEach((x, i) => add(`range ${i + 1}`, x.label, x.cites));
  (b.badges || []).forEach((x, i) => add(`badge ${i + 1}`, x.text, x.cites));
  for (const [k, col] of [["old", b.old], ["new", b.new], ...(b.columns || []).map((c, i) => [`column ${i + 1}`, c])]) (col?.items || []).forEach((it, i) => add(`${k} item ${i + 1}`, typeof it === "string" ? it : it.text, typeof it === "string" ? col.cites : it.cites));
  if (b.compare) {
    add("comparison columns", `${b.compare.us || ""} vs ${b.compare.them || ""}`, b.compare.cites);
    (b.compare.rows || []).forEach((r, i) => add(`comparison row ${i + 1}`, `${r.label}: ${r.us} vs ${r.them}`, r.cites));
  }
  if (b.faq) add("faq", `${b.faq.question} ${b.faq.answer}`, b.faq.cites);
  if (b.question) add("question", `${b.question} ${b.answer || ""}`, b.question_cites);
  // Marketer-supplied lines (review text, proof numbers, prices) are not product-page facts: they must be
  // [placeholders] or carry a source; they are listed for the scorer but not citation-checked.
  add("footnote", b.footnote, c.footnote);
  return L;
}

// sheets: { [handle]: factSheet }, main: the brief's own product handle
export function checkBrief(b, sheets, main) {
  const problems = [];
  const layout = b.layout || "hero";
  if (!LAYOUTS.includes(layout)) problems.push(`unknown layout "${layout}"`);
  const resolve = (cite) => {
    const [h, id] = cite.includes(":") ? cite.split(":") : [main, cite];
    const sheet = sheets[h];
    if (!sheet) return { error: `cites product "${h}" whose facts weren't provided` };
    const fact = sheet.facts.find((f) => f.id === id);
    return fact ? { fact, sheet } : { error: `cites ${cite}, which doesn't exist` };
  };
  for (const line of briefLines(b)) {
    if (!line.cites.length) {
      // The brand's own taglines (on its packs and end cards) are brand lines, not product claims: no page fact needed.
      if (line.label === "tag" && BRAND_LINES.has(line.text.trim().toLowerCase())) continue;
      problems.push(`${line.label} has no citation`);
      continue;
    }
    const got = line.cites.map(resolve);
    got.filter((g) => g.error).forEach((g) => problems.push(`${line.label} ${g.error}`));
    const ok = got.filter((g) => g.fact);
    ok.filter((g) => NOT_CITABLE.has(g.fact.kind)).forEach((g) => problems.push(`${line.label} cites ${g.fact.id} (${g.fact.kind}), which can't support a claim`));
    const allowed = new Set(ok.flatMap((g) => [...nums(g.fact.text), ...nums(g.sheet.title)]));
    const extra = nums(line.text).filter((n) => !allowed.has(n) && !/^step$/i.test(n));
    // step numbers ("Step 1") are layout furniture, not claims
    const isStepNo = (n) => line.label.startsWith("step") && /^[1-3]$/.test(n);
    const bad = extra.filter((n) => !isStepNo(n));
    if (bad.length) problems.push(`${line.label} uses number(s) ${bad.join(", ")} not found in its cited facts`);
  }
  if (layout === "offer") {
    if (!b.offer || !String(b.offer.condition || "").trim()) problems.push("offer layout needs offer.condition next to the offer (CCPA 7)");
  }
  if (layout === "usvsthem") {
    const rows = b.compare?.rows || [];
    if (!rows.length || rows.length > 3) problems.push("usvsthem needs compare.rows: 1–3 rows {label, us, them, cites[]}");
    // ASCI Chapter IV: it must be clear what is compared and on what basis. The basis goes on the creative.
    if (!String(b.footnote || "").trim()) problems.push("usvsthem needs the basis of the comparison in the footnote (what was compared, how, source)");
  }
  if (layout === "journey" && !(b.steps || []).every((s) => sheets[s.product_handle])) problems.push("every journey step needs a product_handle with facts provided");
  if (layout === "range" && !(b.range || []).every((s) => sheets[s.product_handle])) problems.push("every range item needs a product_handle with facts provided");
  return problems;
}

// The ingredient lockup (active + % in the pack's style, public/render.js lockup()) on single-product layouts, unless
// the headline already names both. One rule for the creative, the scorer and the style check (2026-10-04).
// (Not on review cards: the quote is the content and the pack already names the product.)
// Texture shot added 2026-10-05 (app formats): it drew the lockup in the app but the scorer never saw it.
const LOCKUP_LAYOUTS = new Set(["hero", "offer", "socialproof", "texture"]);
const activeLockup = (a) => (a?.pct ? { name: a.name, pct: a.name === "SPF" ? a.pct.replace(/%$/, "") : a.pct } : null);
export function lockupFor(b, sheet) {
  const lk = LOCKUP_LAYOUTS.has(b.layout || "hero") ? activeLockup(sheet?.actives?.[0]) : null;
  if (!lk) return null;
  // Compare with the title the creative actually shows (an offer shows its offer line, not the headline).
  const head = String(b.layout === "offer" && b.offer?.line ? b.offer.line : b.headline || "").toLowerCase();
  return head.includes(lk.name.toLowerCase()) && head.includes(lk.pct.replace(/%$/, "").toLowerCase()) ? null : lk;
}
export const lockupText = (lk) => (lk ? `${lk.name} ${lk.pct}` : "");
export const itemLockup = (label, lk) => (lk && String(label || "").toLowerCase().includes(lk.name.toLowerCase()) && String(label || "").includes(lk.pct.replace(/%$/, "")) ? null : lk);

// Everything printed on the creative, as one ad for the scorer.
// One CTA rule for the creative and the compliance re-check (user review 2026-10-03: "clear CTA is missing"):
// vague CTAs become an action; mirrors ctaText() in public/render.js.
const VAGUE_CTA = /^(learn more|know more|see more|discover( more)?|find out more|read more|explore|see (the )?ingredients|view ingredients|how it works|learn how|see how|find yours)$/i;
export const ctaFor = (b) => { const c = String(b.cta || "").trim(); return c && !VAGUE_CTA.test(c) ? c : ["offer", "pricecompare"].includes(b.layout) ? "Shop the offer" : "Shop now"; };

export function adFromBrief(b0, sheets, main) {
  const b = leanBrief(b0);
  const sheet = sheets[main];
  // Only what the creative draws is scored (judge, 2026-10-04: it once read a "%" line the minimal hero no longer shows).
  // The ingredient lockup is drawn on single-product layouts, so its text is scored.
  const heroLine = lockupText(lockupFor(b, sheet));
  const body = briefLines(b).filter((l) => !["headline", "footnote"].includes(l.label)).map((l) => l.text);
  const offer = [
    ...(b.offer ? [b.offer.line, b.offer.condition, b.offer.valid_till ? `Valid till ${b.offer.valid_till}` : ""] : []),
    ...(b.review ? [b.review.quote, b.review.source] : []),
    ...(b.proof ? [`${b.proof.value} ${b.proof.label}`, b.proof.source] : []),
    ...(b.prices || []).map((p) => `${p.label} ${p.value} ${p.note || ""}`),
    ...(b.frames || []).map((f) => f.label),
  ].filter(Boolean);
  const names = [...(b.steps || []), ...(b.range || [])].map((x) => sheets[x.product_handle]?.title).filter(Boolean);
  return {
    ad_type: "brand",
    headline: b.headline || (b.offer && b.offer.line) || "",
    on_image_text: [heroLine, ...body, ...offer, ...names, sheet.title, SIGN_OFF].filter(Boolean).join("\n"),
    footnote: b.footnote || "",
    cta: ctaFor(b),
    primary_text: b.caption || "",
  };
}

// Render spec for public/render.js. imageSrc fields are resolved to data URLs by the caller.
export function specFromBrief(b0, sheets, main) {
  const b = leanBrief(b0);
  const sheet = sheets[main];
  const prod = (h) => ({ productName: sheets[h]?.title || "", imageSrc: sheets[h]?.images?.[0] || "", lockup: activeLockup(sheets[h]?.actives?.[0]) });
  return {
    layout: b.layout || "hero",
    lockup: lockupFor(b, sheet),
    hero: sheet.actives[0] ? { pct: sheet.actives[0].pct, name: sheet.actives[0].name } : null,
    headline: b.headline,
    subhead: b.subhead,
    proofPoints: b.proof_points || [],
    actives: b.actives,
    steps: (b.steps || []).map((s) => ({ ...s, ...prod(s.product_handle) })),
    stat: b.stat,
    callouts: b.callouts,
    specs: b.specs,
    // A range label that already states the active and its % ("10% Niacinamide") gets no lockup underneath.
    range: (b.range || []).map((r) => { const p = prod(r.product_handle); return { ...r, ...p, lockup: itemLockup(r.label, p.lockup) }; }),
    offer: b.offer,
    photos: b.photos || [],
    tag: b.tag || null, badges: b.badges, old: b.old, new: b.new, columns: b.columns, compare: b.compare, review: b.review, proof: b.proof,
    faq: b.faq, question: b.question, answer: b.answer, prices: b.prices, frames: b.frames, packInFrames: Boolean(b.pack_in_frames),
    aiLabel: Boolean(b.ai_label_required || b.needs_real_photography),
    footnote: b.footnote,
    cta: ctaFor(b),
    productName: ["journey", "range"].includes(b.layout) ? "" : sheet.title,
    imageSrc: sheet.images[0] || "",
    testMark: process.env.TEST_MARK ?? "INTERNAL TEST — not for publication",
  };
}
