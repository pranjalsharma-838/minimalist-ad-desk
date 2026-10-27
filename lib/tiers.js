// Three scores on every report (plan item 3, 2026-10-05), added by lib/score.js as report.scores:
//   alignment  — how Minimalist this ad sounds and looks in text: tone/language rule hits, distance from the brand's
//                measured Meta voice (brand_packs/minimalist/meta_voice_profile.json), the on-image text budget, and
//                the AI judge's tone read when it ran.
//   win        — how closely the ad's measurable features match statics that kept running 30+ days on Meta
//                (competitors in research/competitor_ads + research/competitor_ads_weekly.json, and the brand's own
//                top statics). A proxy, with its sample size, never a forecast.
//   compliance — derived from the verdict. BLOCKED is a hard gate: score 0–20, export stays disabled.
// Alignment and win never change the verdict or the compliance score. Pure code: no API key needed, deterministic.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { measure, words, mentionsActive, ingredientFirst, median } from "./voice_features.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return null; }
};
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const band = (s) => (s == null ? null : s >= 75 ? "high" : s >= 50 ? "medium" : "low");
const WINNER_DAYS = 30;

// ---------------------------------------------------------------- shared text helpers
// What sits on the image: the on-image text plus the headline when the headline isn't already part of it
// (the image-transcription path puts the image's title in `headline`). Footnote and CTA aren't counted, the same
// way scripts/style_check.js leaves them out of the word budget.
export function imageText(ad) {
  const oi = String(ad.on_image_text || "").trim();
  const h = String(ad.headline || "").trim();
  if (!oi) return h;
  return h && !oi.toLowerCase().includes(h.toLowerCase()) ? `${h}\n${oi}` : oi;
}
const copyText = (ad) => [ad.headline, ad.primary_text, ad.on_image_text].filter((x) => String(x || "").trim()).join("\n");

const OFFER = /\b(\d{1,2}\s?%\s?off|off\b|flat\s+\d|buy\s+(any\s+)?\d|b\dg\d|bogo|(?<![-\w])free\b(?!\s*(from|of)\b)|freebie|use code|code\s*[:-]|coupon|sale\b|deals?\b|offer|cashback|@\s?₹?\d|at the cost of|₹\s?\d|rs\.?\s?\d)/i;
const STAT = /\b\d{1,3}(\.\d+)?\s?%\s+(of|subjects|users|people|women|men|reduction|less|more|improvement|saw|said|noticed|agreed|felt)\b|\b\d+(\.\d+)?\s?x\b|\b(in|within)\s+\d+\s+(days?|weeks?|hours?)|\b[\d,.]+\s?(lakh|million|crore|k)\+/i;
const CTA_IMG = /\b(shop now|buy now|order now|download|get it on|install|use code|tap to|click|swipe|grab now)\b/i;
const NO_PEOPLE = /\bno (people|person|model|human|face)s?\b|\bno people\b/i;
const PEOPLE = /\b(woman|women|man|men|model|girl|boy|face|person|creator|selfie|portrait|founder|doctor|dermatologist|lady|guy)\b/i;

// ---------------------------------------------------------------- reference set for the win score
function cleanCompetitorImageText(a) {
  // Competitor on_image_text is " | "-separated and includes pack labels ("[pack: …]", "(product label)") and the
  // brand mark. Those aren't layout text, so they are dropped before counting words.
  const brandKey = String(a.brand || "").toLowerCase().replace(/[^a-z]/g, "");
  return String(a.on_image_text || "")
    .split(/\s*\|\s*/)
    .filter((s) => s && !/^\[pack:|\(.*label.*\)|\blabel\)|^\[/i.test(s) && s.toLowerCase().replace(/[^a-z]/g, "") !== brandKey && !(brandKey && s.toLowerCase().replace(/[^a-z]/g, "").startsWith(brandKey) && words(s) <= 4))
    .join("\n");
}

function personFrom(desc) {
  if (!desc) return null;
  if (NO_PEOPLE.test(desc)) return false;
  return PEOPLE.test(desc);
}

export function loadReference() {
  const ref = [];
  const tags = new Map((readJson("research/winners.json")?.ads || []).map((w) => [String(w.id), w]));
  const dir = path.join(root, "research", "competitor_ads");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const seen = new Set();
  for (const f of files) {
    for (const a of readJson(`research/competitor_ads/${f}`) || []) {
      if (a.format === "video" || seen.has(String(a.id))) continue; // statics only (user rule 2026-10-04)
      seen.add(String(a.id));
      const t = cleanCompetitorImageText(a);
      ref.push({
        id: String(a.id), brand: a.brand, source: "competitor_ads", days: a.days_running ?? 0,
        template_id: tags.get(String(a.id))?.template_id ?? null,
        image_words: words(t), offer: OFFER.test(t), stat: STAT.test(t), cta: CTA_IMG.test(t),
        person: personFrom(a.visual_notes || tags.get(String(a.id))?.one_line),
      });
    }
  }
  // Weekly capture: template tag + start date; its text mixes caption and image, so text features stay unknown.
  for (const a of readJson("research/competitor_ads_weekly.json") || []) {
    if (a.format === "video" || a.is_static_skincare_ad === false || seen.has(String(a.id))) continue;
    seen.add(String(a.id));
    const days = a.started_running && a.captured ? Math.floor((new Date(a.captured) - new Date(a.started_running)) / 864e5) : null;
    if (days == null) continue;
    // Offer = tagged as an offer creative (main or secondary tag), so offer and non-offer weekly ads are both counted.
    const offer = a.template_id == null ? null : a.template_id === 36 || (a.secondary_template_ids || []).includes(36);
    ref.push({ id: String(a.id), brand: a.brand, source: "competitor_ads_weekly", days, template_id: a.template_id ?? null, image_words: null, offer, stat: null, cta: null, person: personFrom(a.one_line) });
  }
  // The brand's own top statics (all running 52–98 days).
  for (const s of readJson("research/minimalist_top_ads/on_image_text.json")?.statics || []) {
    if (seen.has(s.id)) continue;
    const lines = s.cards ? s.cards[0] : s.lines;
    const t = lines.map((l) => l.text).join("\n");
    ref.push({ id: s.id, brand: "Minimalist", source: "minimalist_top_ads", days: s.days_running, template_id: s.template_id ?? null, image_words: words(t), offer: lines.some((l) => ["offer", "condition"].includes(l.role)) || OFFER.test(t), stat: STAT.test(t) || /^\d{1,3}%/.test(t), cta: CTA_IMG.test(t), person: Boolean(s.person) });
  }
  for (const r of ref) r.winner = r.days >= WINNER_DAYS;
  return ref;
}

const TEMPLATES = readJson("config/templates.json")?.templates || [];
let REF = null;
const reference = () => (REF ||= loadReference());

// Wilson interval at 80% (z = 1.28): a plain-language "likely range" for a small group.
function wilson(w, n, z = 1.2816) {
  if (!n) return null;
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(100 * clamp(c - h, 0, 1)), Math.round(100 * clamp(c + h, 0, 1))];
}

const DENSITY = [
  { name: "no text", lo: 0, hi: 0 },
  { name: "1–8 words", lo: 1, hi: 8 },
  { name: "9–20 words", lo: 9, hi: 20 },
  { name: "21–35 words", lo: 21, hi: 35 },
  { name: "36+ words", lo: 36, hi: Infinity },
];
const densityOf = (n) => DENSITY.find((b) => n >= b.lo && n <= b.hi)?.name;

const PERSON_TEMPLATES = new Set([8, 11, 27, 31, 41, 44]);
const NO_PERSON_TEMPLATES = new Set([1, 2, 3, 4, 5, 20, 21, 23, 24, 25, 36, 38, 39, 45, 46]);

function templateFor(ad, ctx) {
  const byId = (id) => TEMPLATES.find((t) => t.id === Number(id));
  if (ctx.template_id != null && byId(ctx.template_id)) return { t: byId(ctx.template_id), how: "given (ctx.template_id)" };
  if (ctx.format) {
    const f = String(ctx.format).toLowerCase();
    const t = TEMPLATES.find((x) => x.name.toLowerCase() === f) || TEMPLATES.find((x) => x.layout === f) || TEMPLATES.find((x) => x.name.toLowerCase().includes(f));
    if (t) return { t, how: `given (ctx.format "${ctx.format}")` };
  }
  // Inferred from wording only where the wording is unambiguous; otherwise the format is left unassessed.
  const it = imageText(ad), all = copyText(ad);
  const guess = /\bstep\s?\d|\b[1-3]\s+(cleanse|treat|protect|moisturi[sz]e)\b|\bcleanse\b.*\bprotect\b/is.test(it) ? 22
    : OFFER.test(it) ? 36
      : /\b(vs\.?|versus|v\/s)\b/i.test(it) ? 19
        : STAT.test(it) ? 25
          : /\?\s*$/.test(String(ad.headline || "").trim()) ? 35
            : /[“"].{10,}[”"]/.test(it) && /\b(review|verified|★|stars?)\b/i.test(all) ? 26 : null;
  return guess ? { t: byId(guess), how: "inferred from the wording (pass ctx.template_id for a firm answer)" } : null;
}

function rateFor(name, pick, value, weight, describe) {
  const ref = reference().filter((r) => pick(r) != null);
  const base = ref.length ? ref.filter((r) => r.winner).length / ref.length : null;
  const group = ref.filter((r) => pick(r) === value);
  const w = group.filter((r) => r.winner).length, n = group.length, k = 5;
  // Shrunk towards the base rate so a group of 2 ads can't swing the score: (wins + 5 x base) / (n + 5).
  const p = (w + k * base) / (n + k);
  return {
    name, weight, score: Math.round(100 * p), n, wins: w, reference_n: ref.length, base_rate: Math.round(100 * base),
    range: wilson(w, n), small_sample: n < 15,
    why: `${describe}: ${w} of ${n} comparable statics ran 30+ days (all statics with this feature known: ${Math.round(100 * base)}% of ${ref.length}). Shrunk towards that base rate${n < 15 ? "; small group, read as a direction only" : ""}.`,
  };
}

export function winScore(ad, ctx = {}) {
  const ref = reference();
  const parts = [];
  const notAssessed = [];
  const tpl = templateFor(ad, ctx);
  if (tpl) parts.push(rateFor("format / template", (r) => r.template_id, tpl.t.id, 0.3, `Format "${tpl.t.name}" (${tpl.how})`));
  else notAssessed.push({ name: "format / template", score: null, n: null, why: "Not assessed: no ctx.template_id / ctx.format given and the wording doesn't show the format. The image itself isn't read by this score." });

  const it = imageText(ad);
  if (it.trim() || ctx.image_words != null) {
    const n = ctx.image_words ?? words(it);
    parts.push(rateFor("text density on the image", (r) => (r.image_words == null ? null : densityOf(r.image_words)), densityOf(n), 0.2, `${n} words on the image (${densityOf(n)}; headline + on-image text, footnote not counted)`));
    const offer = OFFER.test(it);
    parts.push(rateFor("offer on the image", (r) => r.offer, offer, 0.15, offer ? "Shows an offer" : "No offer on the image"));
    const stat = STAT.test(it);
    parts.push(rateFor("stat / number claim on the image", (r) => r.stat, stat, 0.1, stat ? "Leads with a stat or number" : "No stat on the image"));
    const cta = CTA_IMG.test(it) || CTA_IMG.test(String(ad.cta || "")) && ctx.cta_on_image === true;
    parts.push(rateFor("CTA drawn on the image", (r) => r.cta, cta, 0.15, cta ? "A CTA is drawn on the image" : "No CTA drawn on the image (Meta's button only)"));
  } else {
    notAssessed.push({ name: "text density / offer / stat / CTA on the image", score: null, n: null, why: "Not assessed: no headline or on-image text given." });
  }
  const person = ctx.has_person != null ? Boolean(ctx.has_person) : tpl && PERSON_TEMPLATES.has(tpl.t.id) ? true : tpl && NO_PERSON_TEMPLATES.has(tpl.t.id) ? false : null;
  if (person != null) parts.push(rateFor("person in the image", (r) => r.person, person, 0.1, `${person ? "Shows a person" : "No person"} (${ctx.has_person != null ? "given (ctx.has_person)" : "from the format"})`));
  else notAssessed.push({ name: "person in the image", score: null, n: null, why: "Not assessed: pass ctx.has_person (the image itself isn't read by this score)." });

  const wsum = parts.reduce((s, p) => s + p.weight, 0);
  const score = parts.length ? Math.round(parts.reduce((s, p) => s + p.weight * p.score, 0) / wsum) : null;
  // The base rate the score is read against: the same weighted mix of each part's own base rate (the parts use
  // different subsets of the reference, e.g. the weekly capture has no on-image text).
  const baseAll = parts.length ? Math.round(parts.reduce((s, p) => s + p.weight * p.base_rate, 0) / wsum) : ref.length ? Math.round((100 * ref.filter((r) => r.winner).length) / ref.length) : null;
  const lo = parts.length ? Math.round(parts.reduce((s, p) => s + p.weight * (p.range ? p.range[0] : p.score), 0) / wsum) : null;
  const hi = parts.length ? Math.round(parts.reduce((s, p) => s + p.weight * (p.range ? p.range[1] : p.score), 0) / wsum) : null;
  const smallest = parts.length ? Math.min(...parts.map((p) => p.n)) : 0;
  const brands = new Set(ref.map((r) => r.brand)).size;
  return {
    score,
    // Relative to the base rate, because nearly every captured static is a long runner: "high" = features that
    // ran 30+ days more often than average, "low" = less often.
    band: score == null ? null : score >= baseAll + 4 ? "high" : score <= baseAll - 4 ? "low" : "medium",
    n: ref.length,
    range: score == null ? null : [Math.min(lo, score), Math.max(hi, score)],
    small_sample: smallest < 15,
    base_rate: baseAll,
    basis: `Share of comparable Meta statics that were still running after 30+ days, across ${ref.length} statics from ${brands} brands (India, Meta Ad Library, captured 2–5 Oct 2026; competitors + Minimalist's own top statics). "Still running after 30+ days" is a proxy for "worked": Meta keeps spending on ads that perform, but some long runners are simply never switched off, and ads younger than 30 days are too new to judge, not failures. Most captured statics are long runners (${baseAll}% for the features assessed here), so scores sit close to that: the band says whether this ad's features ran 30+ days more often (high) or less often (low) than that; read the band and range, not the decimal. Pure code on the ad's text${parts.length < 6 ? "; parts not assessed are listed" : ""}.`,
    parts: [...parts.map(({ weight, ...p }) => p), ...notAssessed],
  };
}

// ---------------------------------------------------------------- alignment
let PROFILE;
const profile = () => (PROFILE === undefined ? (PROFILE = readJson("brand_packs/minimalist/meta_voice_profile.json")) : PROFILE);

const SEV_COST = { block: 40, fix: 25, advisory: 8 };

// Policy rules that also rest on the brand's STATED philosophy (BRAND-§6-S3: no absolutes, no "chemical-free", no
// "clean = safe"). They count in compliance; here they cost a flat 15 because the wording is also off-voice.
const PHILOSOPHY = (f) => f.dimension === "policy" && (f.sources || []).includes("BRAND-§6-S3");

function rulesPart(findings) {
  const tl = findings.filter((f) => f.dimension === "tone" || f.dimension === "language");
  const ph = findings.filter(PHILOSOPHY);
  const cost = tl.reduce((s, f) => s + (SEV_COST[f.severity] || 0), 0) + 15 * ph.length;
  const list = (fs_) => fs_.map((f) => `${f.rule_id} ${f.severity} "${f.span}"`).join("; ");
  return {
    name: "tone & language rules",
    score: clamp(100 - cost),
    why: tl.length || ph.length
      ? [tl.length ? `${tl.length} tone/language finding(s): ${list(tl)} (fix −25, advisory −8 each)` : "", ph.length ? `${ph.length} claim(s) that contradict the brand's stated philosophy: ${list(ph)} (−15 each; their legal weight is in compliance)` : ""].filter(Boolean).join(". ") + "."
      : "No tone or language rule hits (TON-*, LNG-*) and nothing against the brand's stated philosophy. Other policy findings count in compliance, not here.",
  };
}

// Closeness for a "less is fine" rate: at or below the brand's own level (with a little slack) scores 1.
const ceiling = (val, brand, floor) => {
  const allow = Math.max(brand * 1.5, floor);
  return val <= allow ? 1 : clamp(1 - (val - allow) / (allow + 2), 0, 1);
};

function voicePart(ad) {
  const P = profile();
  if (!P) return { name: "Meta voice match", score: null, why: "Not assessed: brand_packs/minimalist/meta_voice_profile.json is missing (run node scripts/build_meta_voice.js)." };
  const T = P.targets;
  const text = copyText(ad);
  const m = measure(text);
  if (m.words < 3) return { name: "Meta voice match", score: null, why: "Not assessed: under 3 words of copy." };
  const checks = [];
  const add = (label, c, detail) => checks.push({ label, c, detail });
  if (m.median_sentence_words != null) {
    const s = m.median_sentence_words, { p25, p75, median: med } = T.sentence_words;
    // Inside the brand's middle range (with a few words of slack) is a match; further out costs gradually.
    const c = s >= p25 - 2 && s <= p75 + 4 ? 1 : clamp(1 - (s < p25 ? p25 - 2 - s : s - p75 - 4) / Math.max(med, 4), 0, 1);
    add("sentence length", c, `median ${s} words per sentence vs the brand's ${med} (middle half ${p25}–${p75})`);
  }
  add("exclamation marks", ceiling(m.exclamation_per_100w, T.exclamation_per_100w, 1), `${m.exclamation_per_100w} per 100 words vs the brand's ${T.exclamation_per_100w}`);
  add("emoji", ceiling(m.emoji_per_100w, T.emoji_per_100w, 0.5), `${m.emoji_per_100w} per 100 words vs the brand's ${T.emoji_per_100w}`);
  add("hype words", ceiling(m.hype_per_100w, T.hype_per_100w, 0.5), `${m.hype.length ? m.hype.map((h) => `"${h}"`).join(", ") : "none"} (${m.hype_per_100w}/100 words vs the brand's ${T.hype_per_100w})`);
  add("fear / problem words", ceiling(m.fear_per_100w, T.fear_per_100w, 0.5), `${m.fear.length ? m.fear.map((h) => `"${h}"`).join(", ") : "none"} (${m.fear_per_100w}/100 words vs the brand's ${T.fear_per_100w})`);
  const opener = ingredientFirst(ad.headline || "") || ingredientFirst(ad.on_image_text || "") || ingredientFirst(ad.primary_text || "");
  add("ingredient / % first", opener ? 1 : m.mentions_active ? 0.7 : 1 - T.opener_names_active_share, opener ? "opens with an active or a concentration (as the brand does in " + Math.round(100 * T.opener_names_active_share) + "% of its openers)" : m.mentions_active ? "names an active or %, but not in the opening line" : `names no active or concentration (the brand does in ${Math.round(100 * T.opener_names_active_share)}% of openers)`);
  if (m.hook) {
    const shares = T.hook_shares || {};
    const top = Math.max(...Object.values(shares), 0.01);
    const sh = shares[m.hook] || 0;
    add("hook type", m.hook === "fear_problem" ? 0 : clamp(sh / top + 0.25, 0, 1), `opening hook reads as "${m.hook.replace("_", " ")}" (${Math.round(100 * sh)}% of the brand's long-running copies${m.hook === "fear_problem" ? "; fear hooks score 0 here whatever the brand's live copy does" : ""})`);
  }
  if (m.hedge) add("hedged outcomes", m.hedge.share >= (T.hedged_share || 0) ? 1 : m.hedge.share / T.hedged_share, `${m.hedge.hedged} of ${m.hedge.efficacy_sentences} outcome lines hedged ("helps", "visibly", "designed to") vs the brand's ${Math.round(100 * T.hedged_share)}%; hedging more than the brand is never marked down`);
  const score = Math.round((100 * checks.reduce((s, x) => s + x.c, 0)) / checks.length);
  return {
    name: "Meta voice match",
    score,
    why: `Measured against ${P.ad_copy.used.distinct_copies} long-running brand copies and ${P.on_image.ads} top statics (meta_voice_profile.json, built ${P.built}): ${checks.map((x) => `${x.label} ${Math.round(100 * x.c)} — ${x.detail}`).join("; ")}.`,
  };
}

function stylePart(ad, ctx) {
  const P = profile();
  const it = imageText(ad);
  if (!it.trim()) return { name: "on-image text budget", score: null, why: "Not assessed: no headline or on-image text given." };
  const LIST = new Set(["actives", "journey", "range", "timeline", "splitscreen", "callouts", "badges", "spec", "faq", "oldnew", "thisvsthat", "usvsthem", "before_after"]);
  const layout = ctx.layout || (ctx.template_id ? TEMPLATES.find((t) => t.id === Number(ctx.template_id))?.layout : null);
  // Ceilings = scripts/style_check.js (20 single / 30 list), never tighter than the brand's own observed maximum.
  const single = Math.max(20, P?.targets?.image_words_single_max ?? 20);
  const list = Math.max(30, P?.targets?.image_words_card_max ?? 30);
  const limit = LIST.has(layout) || /\bstep\s?\d|\b[1-3]\s+(cleanse|treat|protect)\b/i.test(it) ? list : single;
  const n = words(it), hw = words(ad.headline);
  const studyQuote = /\b\d{1,3}\s?%\s+(of\s+)?(subjects\s+)?(said|agreed|noticed|felt|saw|reported)\b/i.test(ad.headline || "");
  const issues = [];
  let s = 100;
  if (n > limit) { s -= 4 * (n - limit); issues.push(`${n} words on the image (limit ${limit})`); }
  if (hw > 8 && !studyQuote) { s -= 15; issues.push(`headline ${hw} words (limit 8)`); }
  if (String(ad.footnote || "").length > 120) { s -= 10; issues.push(`footnote ${String(ad.footnote).length} characters (about 2 lines max)`); }
  return {
    name: "on-image text budget",
    score: clamp(s),
    why: `${n} words on the image (brand's single statics: ${P?.targets?.image_words_single_median ?? "?"} median, ${P?.targets?.image_words_single_max ?? "?"} max; limit used ${limit}), headline ${hw} word(s)${issues.length ? `. Over budget: ${issues.join("; ")}` : ". Within the budget"}. Counts words only; layout, white space and product size are not seen by this score.`,
  };
}

// Transparency and no exaggeration (user, 2026-10-05: "Minimalist is very transparent and no exaggeration"): the brand
// shows its actives and their strength, backs every number, and never oversells. Exaggeration words and numbers with
// no basis on the creative lower this part; showing the active + % is the brand's habit and counts in its favour.
const EXAGGERATION = /\b(best|ultimate|miracle|magic(al)?|revolutionary|game[- ]?changer|holy grail|instant(ly)?|overnight|flawless|perfect(ion)?|guaranteed?|forever|permanent(ly)?|completely|totally|amazing|incredible|unbelievable|insane|glass skin|transform(s|ing|ation)?|superior|unbeatable|no\.?\s?1|#1|world'?s first|like never before)\b|100\s?%(?!\s*(pure|of\s+subjects))/gi;
function transparencyPart(ad, ctx) {
  const it = [ad.headline, ad.on_image_text].filter(Boolean).join("\n");
  const all = [it, ad.primary_text].filter(Boolean).join("\n");
  if (!all.trim()) return { name: "transparency & no exaggeration", score: null, why: "Not assessed: no ad text given." };
  const hype = [...new Set((all.match(EXAGGERATION) || []).map((x) => x.toLowerCase()))];
  // A number on the image (other than a concentration / SPF / pack size) needs its basis in the footnote.
  const nums = (it.match(/\b\d{1,3}(?:\.\d+)?\s?%(?=\s+(of\s+)?(subjects|users|people|customers|participants|saw|said|noticed|felt|reported|reduction|less|more|fewer))|\b\d+(?:\.\d+)?\s?x\s+(more|better|faster)|\b\d+\s+(days|weeks)\b/gi) || []);
  const unsupported = nums.length && !String(ad.footnote || "").trim() ? nums : [];
  const showsStrength = /\b\d{1,2}(?:\.\d+)?\s?%|\bSPF\s?\d{2}\b/i.test(it);
  let s = 100 - 12 * hype.length - 15 * unsupported.length + (showsStrength ? 0 : -5);
  const notes = [];
  if (hype.length) notes.push(`exaggeration: ${hype.join(", ")}`);
  if (unsupported.length) notes.push(`number(s) with no basis on the creative: ${unsupported.join(", ")}`);
  notes.push(showsStrength ? "shows the active's strength, as the brand does" : "no strength (% / SPF) on the image — the brand nearly always shows it");
  return { name: "transparency & no exaggeration", score: clamp(s), why: `${notes.join("; ")}.` };
}

function judgePart(report) {
  if (!report.coverage?.model) return { name: "AI judge tone read", score: null, why: `Not assessed: the AI judge didn't run (${report.coverage?.model_error ? `error: ${report.coverage.model_error}` : "rules-only check / no API key"}). Implied tone isn't read without it.` };
  const tl = report.findings.filter((f) => f.layer === "model" && (f.dimension === "tone" || f.dimension === "language"));
  const cost = tl.reduce((s, f) => s + (SEV_COST[f.severity] || 0), 0);
  return { name: "AI judge tone read", score: clamp(100 - cost), why: `${report.tone_read || "(no tone read returned)"}${tl.length ? ` — the judge added ${tl.length} tone/language finding(s)` : ""}` };
}

export function alignmentScore(report, ctx = {}) {
  const ad = report.ad;
  const creator = ad.ad_type === "creator";
  const W = { rules: 0.3, voice: creator ? 0.1 : 0.3, transparency: 0.2, style: 0.15, judge: 0.1 };
  const parts = [
    { ...rulesPart(report.findings), w: W.rules },
    { ...voicePart(ad), w: W.voice },
    { ...transparencyPart(ad, ctx), w: W.transparency },
    { ...stylePart(ad, ctx), w: W.style },
    { ...judgePart(report), w: W.judge },
  ];
  if (creator) parts[1].why = `Creator ad: compared with the brand's own voice for reference only (weight lowered). ${parts[1].why}`;
  const assessed = parts.filter((p) => p.score != null);
  const score = assessed.length ? Math.round(assessed.reduce((s, p) => s + p.w * p.score, 0) / assessed.reduce((s, p) => s + p.w, 0)) : null;
  return { score, band: band(score), parts: parts.map(({ w, ...p }) => p) };
}

// ---------------------------------------------------------------- compliance
export function complianceScore(report) {
  const v = report.verdict;
  const c = (sev, dims = null) => report.findings.filter((f) => f.severity === sev && (!dims || dims.includes(f.dimension))).length;
  let score;
  if (v.code === "BLOCKED") score = clamp(20 - 5 * (c("block") - 1), 0, 20);
  else if (v.code === "NEEDS_CHANGES") score = clamp(60 - 5 * (c("fix") - 1), 35, 60);
  else if (v.code === "LIMITED_CHECK") score = clamp(80 - 2 * c("advisory", ["policy"]), 70, 80);
  else score = clamp(100 - 2 * c("advisory", ["policy"]), 85, 100);
  return {
    code: v.code,
    label: v.label,
    score,
    gate: v.code === "BLOCKED" ? "hard" : "none",
    export_allowed: v.code !== "BLOCKED",
    why: v.code === "BLOCKED"
      ? `${c("block")} blocking finding(s). Hard gate: score capped at 0–20 and export disabled, whatever the alignment or win scores say.`
      : v.code === "NEEDS_CHANGES" ? `${c("fix")} must-fix finding(s) (scores 35–60 until fixed).`
        : v.code === "LIMITED_CHECK" ? "No rule hits, but the AI judge didn't run, so implied claims weren't read (70–80, never higher on rules alone)."
          : "No blocking or must-fix findings. A pre-screen, not an approval.",
  };
}

export function scoreTiers(report, ctx = {}) {
  const compliance = complianceScore(report);
  const alignment = alignmentScore(report, ctx);
  const win = winScore(report.ad, ctx);
  const gated = compliance.gate === "hard";
  if (gated) {
    alignment.note = "Shown for learning only: the ad is blocked on compliance.";
    win.note = "Shown for learning only: the ad is blocked on compliance.";
  }
  return {
    alignment,
    win,
    compliance,
    assessed_with: report.coverage?.model ? "rules + AI judge" : "rules only (no AI judge)",
    rule: "Compliance is the gate. Alignment and win never change the verdict, the compliance score or export.",
  };
}
