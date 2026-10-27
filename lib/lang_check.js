// Add-on (g) — compliance for Hindi / regional-language versions. The English rule layer can't read Devanagari,
// Tamil, Bengali etc., so a translated ad passes only if ALL of these hold:
//  1. back-translation: every translated line carries a literal English back-translation; the full English rule
//     layer (lib/rules.js) runs on the back-translated ad with the same product sheet.
//  2. numbers lock: every number / % / SPF / price in the English line appears unchanged in the translation
//     (digits may be written in the native script — they are normalised) and no new number appears.
//  3. native risk words: a per-language list of words that make a cosmetic sound like a drug, fairness, or
//     guarantee claim; any hit = fix (a human reviews it).
//  4. same-language disclaimer (CCPA-11): the footnote must be translated, not left in English.
import { runRules } from "./rules.js";

const NATIVE_DIGITS = { "०": 0, "१": 1, "२": 2, "३": 3, "४": 4, "५": 5, "६": 6, "७": 7, "८": 8, "९": 9, "০": 0, "১": 1, "২": 2, "৩": 3, "৪": 4, "৫": 5, "৬": 6, "৭": 7, "৮": 8, "৯": 9, "௦": 0, "௧": 1, "௨": 2, "௩": 3, "௪": 4, "௫": 5, "௬": 6, "௭": 7, "௮": 8, "௯": 9 };
const normDigits = (s) => String(s || "").replace(/[०-९০-৯௦-௯]/g, (d) => NATIVE_DIGITS[d]);
const numbers = (s) => (normDigits(s).replace(/,(?=\d{2,3}\b)/g, "").match(/\d+(?:\.\d+)?/g) || []).sort();

// Words that, in an ad, push a cosmetic toward a drug / fairness / guarantee claim. Conservative on purpose.
export const RISK_WORDS = {
  hi: [/इलाज/, /उपचार/, /ठीक कर/, /दवा/, /रोग/, /बीमारी/, /गोरा|गोरी|गोरापन|निखार लाए/, /दाग.?धब्बे (हटा|मिटा|खत्म)/, /हमेशा के लिए/, /गारंटी/, /100%\s*(असरदार|परिणाम)/, /सबसे (सस्ता|अच्छा|बेहतरीन)/, /डॉक्टर/, /चमत्कार/],
  mr: [/उपचार/, /इलाज/, /बरे कर/, /औषध/, /गोरा|गोरी|गोरेपणा/, /हमी/, /सर्वात (स्वस्त|उत्तम)/, /डॉक्टर/],
  ta: [/சிகிச்சை/, /குணப்படுத்த/, /மருந்து/, /நோய்/, /சிவப்பழகு|வெண்மை(யாக்க)?/, /உத்தரவாதம்/, /மிகச் சிறந்த|மலிவான/, /மருத்துவர்/],
  te: [/చికిత్స/, /నయం/, /మందు/, /వ్యాధి/, /తెల్లగా|తెలుపు/, /హామీ/, /అత్యుత్తమ|చౌకైన/, /డాక్టర్/],
  bn: [/চিকিৎসা/, /সারিয়ে/, /ওষুধ/, /রোগ/, /ফর্সা/, /গ্যারান্টি/, /সবচেয়ে (সস্তা|ভালো)/, /ডাক্তার/],
};
const SCRIPT = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, ta: /[஀-௿]/, te: /[ఀ-౿]/, bn: /[ঀ-৿]/ };
const FIELDS = ["headline", "primary_text", "on_image_text", "footnote", "cta"];

// version: { lang, lines: { <field>: { text, back_translation } } }; englishAd: the English ad (same fields).
export function checkTranslation(englishAd, version, ctx = {}) {
  const findings = [];
  const lang = version.lang;
  const back = { ad_type: englishAd.ad_type || "brand" };
  for (const f of FIELDS) {
    const en = englishAd[f] || "", tr = version.lines?.[f]?.text || "", bt = version.lines?.[f]?.back_translation || "";
    back[f] = bt;
    if (!en.trim()) continue;
    if (!tr.trim()) { findings.push({ check: "missing_line", field: f, severity: "fix", message: `${f} not translated.` }); continue; }
    if (!bt.trim()) findings.push({ check: "no_back_translation", field: f, severity: "fix", message: `${f} has no English back-translation, so it can't be rule-checked.` });
    const a = numbers(en).join(","), b = numbers(tr).join(",");
    if (a !== b) findings.push({ check: "numbers_lock", field: f, severity: "block", message: `Numbers differ — English [${a}] vs ${lang} [${b}]. Every %, SPF, price and count must match exactly.` });
    for (const rx of RISK_WORDS[lang] || []) { const m = tr.match(rx); if (m) findings.push({ check: "native_risk_word", field: f, severity: "fix", span: m[0], message: `"${m[0]}" can read as a drug / fairness / guarantee claim in ${lang}; a fluent reviewer must confirm or replace it.` }); }
    if (f === "footnote" && SCRIPT[lang] && !SCRIPT[lang].test(tr)) findings.push({ check: "disclaimer_language", field: f, severity: "fix", message: "Footnote/disclaimer is not in the ad's language (CCPA-11: same language as the claim)." });
  }
  for (const r of runRules(back, ctx).filter((x) => x.severity !== "advisory")) findings.push({ check: "rules_on_back_translation", field: r.field, severity: r.severity, span: r.span, rule_id: r.rule_id, message: r.message });
  const worst = findings.some((x) => x.severity === "block") ? "block" : findings.length ? "fix" : "pass";
  return { lang, verdict: worst, findings, note: "Machine checks only — a fluent human reviewer signs off every non-English version before use." };
}
