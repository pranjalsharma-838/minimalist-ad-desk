// Measurable voice features of ad text. Used twice, with the same code:
//   scripts/build_meta_voice.js  -> measures Minimalist's own long-running Meta ads (brand_packs/minimalist/meta_voice_profile.json)
//   lib/tiers.js                 -> measures the ad being scored, so the two sets of numbers are comparable.
// Pure functions, no I/O apart from reading the rulebook (hype / fear patterns come from TON-02 / TON-01 so the
// voice numbers and the rules agree on what a hype or fear word is).
import { RULE_INDEX } from "./rules.js";

// Same word definition as scripts/style_check.js: "1,491", "2-3", "40-50%" count once; a lone "+" or "&" doesn't.
export const words = (s) => (String(s || "").match(/[\p{L}\p{N}][\p{L}\p{N}%₹+'’.,-]*/gu) || []).length;

const rx = (id) => (RULE_INDEX.get(id)?.patterns || []).map((p) => new RegExp(p, "giu"));
const HYPE = rx("TON-02");
const FEAR = rx("TON-01");

// Actives Minimalist (and the category) name in copy. A % figure also counts as "ingredient / concentration first".
const ACTIVE = /\b(niacinamide|salicylic|retinol|retinal|vitamin\s?[a-z]\d{0,2}|hyaluronic|glycolic|lactic|mandelic|kojic|arbutin|squalane|ceramides?|oat extract|peptides?|azelaic|tranexamic|aha|bha|pha|lha|zinc|marula|alpha lipoic|ascorbic|centella|cica|benzoyl|capixyl|redensyl|procapil|caffeine|sepicalm|copper|polyglutamic|bakuchiol|urea|panthenol|allantoin|spf\s?\d+)\b|\b\d{1,3}(\.\d+)?\s?%/i;

// Outcome verbs and the brand's hedges ("helps", "visibly", "the look of", "designed to").
const EFFICACY = /\b(reduc\w*|brighten\w*|fad\w*|even(s|ing)?\b|hydrat\w*|sooth\w*|exfoliat\w*|improv\w*|boost\w*|clear\w*|protect\w*|calm\w*|smooth\w*|firm\w*|repair\w*|control\w*|fight\w*|target\w*|minimi[sz]\w*)\b/i;
const HEDGE = /\b(help(s|ing)?|visibly|look of|appearance|designed to|support\w*|[a-z]+-looking|feel(s|ing)?|may)\b/i;

const CTA_TEXT = /\b(shop now|shop the [\w ]{1,20}|order now|buy now|get yours|grab (it|yours|now)|discover|try (it|now)|learn more|see details|click|add to cart|comment ["“]?\w+["”]?)\b/gi;

export const strip = (s) => String(s || "")
  .split("\n")
  .filter((l) => !/^\s*(#\w+\s*)+$/.test(l)) // hashtag-only lines
  .join("\n")
  .replace(/#\w+/g, " ");

export function sentences(s) {
  return strip(s)
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((x) => x.replace(/^[-•·*\s]+/, "").trim())
    .filter((x) => words(x) > 0);
}

export function count(re, s) {
  if (Array.isArray(re)) return re.reduce((n, r) => n + count(r, s), 0);
  return [...String(s || "").matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].length;
}

export function hits(res, s) {
  const out = [];
  for (const r of res) for (const m of String(s || "").matchAll(new RegExp(r.source, r.flags))) out.push(m[0]);
  return out;
}

export const emojiCount = (s) => count(/\p{Extended_Pictographic}/u, s);
export const exclamationCount = (s) => count(/!/, s);
export const hypeHits = (s) => hits(HYPE, s);
export const fearHits = (s) => hits(FEAR, s);
export const mentionsActive = (s) => ACTIVE.test(String(s || ""));
export const ctaPhrases = (s) => [...String(s || "").matchAll(CTA_TEXT)].map((m) => m[0].toLowerCase());

// Ingredient / concentration first: the opening line (or its first 8 words) names an active or a %.
export function ingredientFirst(s) {
  const first = sentences(s)[0] || "";
  return mentionsActive(first.split(/\s+/).slice(0, 8).join(" "));
}

// Hook type of the opening line. Order matters: fear/problem is checked first so it is never hidden by "offer".
export const HOOKS = ["fear_problem", "offer", "product_intro", "ingredient_led", "brand_trust", "you_statement", "question", "statement"];
export function hookType(s) {
  const first = sentences(s)[0] || "";
  if (!first) return null;
  if (fearHits(first).length || /^(sick of|struggling|dealing with)\b/i.test(first)) return "fear_problem";
  if (/\b(buy|free|freebie|offer|cashback|\d+\s?% off|coupon|code|sale|deal|at the cost of|price)\b/i.test(first)) return "offer";
  if (/^(meet|introducing|new|presenting|say hello)\b/i.test(first)) return "product_intro";
  if (ingredientFirst(first)) return "ingredient_led";
  if (/\b(science|scientific|transparen\w*|hide nothing|nothing to hide|in-house|backed by|clinically tested)\b/i.test(first)) return "brand_trust";
  if (/\?\s*$/.test(first)) return "question";
  if (/^(your|you)\b/i.test(first)) return "you_statement";
  return "statement";
}

export function hedgeShare(s) {
  const eff = sentences(s).filter((x) => EFFICACY.test(x));
  if (!eff.length) return null;
  return { efficacy_sentences: eff.length, hedged: eff.filter((x) => HEDGE.test(x)).length, share: eff.filter((x) => HEDGE.test(x)).length / eff.length };
}

const per100 = (n, w) => (w ? (100 * n) / w : 0);

// All features of one piece of text, in one object (rates per 100 words).
export function measure(s) {
  const text = strip(s);
  const w = words(text);
  const sents = sentences(text);
  const sw = sents.map(words);
  const hype = hypeHits(text), fear = fearHits(text);
  return {
    words: w,
    sentences: sents.length,
    sentence_words: sw,
    median_sentence_words: median(sw),
    emoji: emojiCount(s),
    exclamations: exclamationCount(s),
    emoji_per_100w: +per100(emojiCount(s), w).toFixed(2),
    exclamation_per_100w: +per100(exclamationCount(s), w).toFixed(2),
    hype, fear,
    hype_per_100w: +per100(hype.length, w).toFixed(2),
    fear_per_100w: +per100(fear.length, w).toFixed(2),
    second_person_per_100w: +per100(count(/\b(you|your|you're|yours)\b/i, text), w).toFixed(2),
    ingredient_first: ingredientFirst(text),
    mentions_active: mentionsActive(text),
    hook: hookType(text),
    hedge: hedgeShare(text),
    cta_phrases: ctaPhrases(text),
  };
}

export function median(xs) {
  const a = (xs || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function quantile(xs, q) {
  const a = (xs || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return +(a[lo] + (a[hi] - a[lo]) * (i - lo)).toFixed(2);
}
