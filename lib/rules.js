// Deterministic rule layer. Reads rules/brand_rules.json (the standard) and returns findings with
// exact character spans. This layer runs with or without an API key and its findings can never be
// removed by the model layer — only added to (see lib/score.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, knownPcts, normPct } from "./catalog.js";
import { applyDecisions } from "./decisions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RULES = JSON.parse(fs.readFileSync(path.join(here, "..", "rules", "brand_rules.json"), "utf8"));
export const RULE_INDEX = new Map(RULES.rules.map((r) => [r.id, r]));

export const FIELDS = ["headline", "primary_text", "on_image_text", "footnote", "cta"];
const SEV_ORDER = ["advisory", "fix", "block"];
// Claim types that are never lowered for appearing on the product page. Empty by the user's decision (2026-10-05:
// "things which are mentioned in listing will be treated leniently"): every claim the listing makes is lowered one step.
// Legal can add rule ids here (e.g. "CLM-02") to keep a claim type at full severity even when the page says it.
const PAGE_DENY = new Set([]);
const lower = (s) => SEV_ORDER[Math.max(0, SEV_ORDER.indexOf(s) - 1)];

// Replace Minimalist product names with same-length filler so offsets survive and names like
// "Lip Treatment Balm" / "Healing Ointment" don't trigger drug-claim patterns.
function maskProductNames(text, extraNames = []) {
  let out = text;
  // Advertiser / brand names too: "Heaven Magic" is a name, not hype (stand-in eval false positive).
  const variants = extraNames
    .filter((n) => n && n.length > 2)
    .flatMap((n) => {
      const base = n.replace(/\s+with\s+.*$/i, "").trim(); // "creator with Brand" -> "creator"
      const short = base.replace(/\s*[-–]\s*.*$/, "").replace(/\s+(beauty|skincare|skin care|co\.?|india|official)$/i, "").trim();
      return [base, short].filter((v) => v.length > 2);
    });
  for (const t of [...new Set(variants), ...CATALOG.titles]) {
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, (m) => "·".repeat(m.length));
  }
  return out;
}

export function sentenceAround(text, start, end) {
  const before = text.lastIndexOf("\n", start);
  const s = Math.max(before, ...[". ", "! ", "? "].map((p) => text.lastIndexOf(p, start))) + 1;
  const ends = ["\n", ". ", "! ", "? "].map((p) => text.indexOf(p, end)).filter((i) => i >= 0);
  const e = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(s, e).trim();
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ").trim();

// Does this ad sentence come from the product page? Token overlap against each fact.
export function findProvenance(sentence, sheet) {
  if (!sheet || !sheet.facts) return null;
  const toks = norm(sentence).split(" ").filter((t) => t.length > 2);
  if (toks.length === 0) return null;
  let best = null;
  for (const f of sheet.facts) {
    if (f.kind === "testimonial" || f.kind === "inci") continue;
    const ft = new Set(norm(f.text).split(" "));
    const hit = toks.filter((t) => ft.has(t)).length / toks.length;
    if (hit >= 0.8 && (!best || hit > best.hit)) best = { id: f.id, hit, text: f.text };
  }
  return best;
}

function finding(rule, field, text, start, end, extra = {}) {
  return {
    rule_id: rule.id,
    dimension: rule.dimension,
    severity: rule.severity,
    title: rule.title,
    field,
    start,
    end,
    span: text.slice(start, end),
    message: rule.message,
    fix: rule.fix,
    sources: rule.sources,
    confidence: rule.confidence,
    layer: "rule",
    ...extra,
  };
}

// ---- computed checks (things a regex alone can't decide) ----
const COMPUTED = {
  // "Niacinamide 12%" / "12% Niacinamide" where no Minimalist product sells that strength.
  concentration_mismatch(rule, field, text, ctx) {
    const out = [];
    // [ \t] not \s: "…Salicylic Acid + LHA\n6% …" must not read as "LHA 6%" (first gate run).
    const re = /\b(\d{1,2}(?:\.\d+)?)[ \t]?%[ \t]+([A-Z][A-Za-z\- ]{2,30}?)(?=[\s,.;:!)]|$)|\b([A-Z][A-Za-z\-]{2,30}(?: [A-Z][A-Za-z\-]+)?)[ \t]+(\d{1,2}(?:\.\d+)?)[ \t]?%/g;
    let m;
    while ((m = re.exec(text))) {
      const pct = m[1] || m[4];
      const ing = (m[2] || m[3]).trim();
      // "LHA 6% penetration", "Salicylic Acid ~58%": a measured figure, not a concentration (first gate
      // run). Those are statistics (CLM-08 / model layer), not CLM-20.
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
      const before = text.slice(Math.max(0, m.index - 2), m.index);
      if (/^[ \t]*(penetration|absorption|reduction|increase|decrease|more|less|of|in|subjects|users|hydration|moisture|pure|purity|content|better|faster|vs\b)/i.test(after) || /~/.test(before + (m[0].match(/~/) || ""))) continue;
      // The attached product at its own strength is correct, whatever the catalog fuzzy-lookup says
      // ("Stated 32% but this product is 32%" was a false block on the first gate run).
      if (ctx.sheet && [ctx.sheet, ...(ctx.extraSheets || [])].some((sh) => sameIngredient(ing, sh) && sh.actives.some((a) => normPct(a.pct) === normPct(pct)))) continue;
      const known = knownPcts(ing);
      if (!known) continue;
      // Component strengths stated on the attached product page are correct even if the catalog title
      // only has the total: "25% AHA, 5% PHA, 2% BHA" on the AHA PHA BHA 32% peel (first gate run).
      if (ctx.sheet && ctx.sheet.facts.some((f) => new RegExp(`\\b0*${pct.replace(".", "\\.")}\\s?%\\s*${ing.split(/\s+/)[0]}|${ing.split(/\s+/)[0]}\\s*0*${pct.replace(".", "\\.")}\\s?%`, "i").test(f.text))) continue;
      const productPcts = ctx.sheet ? ctx.sheet.actives.map((a) => normPct(a.pct)) : null;
      if (known.includes(normPct(pct)) && (!productPcts || productPcts.includes(normPct(pct)) || !sameIngredient(ing, ctx.sheet))) continue;
      const where = productPcts && sameIngredient(ing, ctx.sheet) ? `this product is ${ctx.sheet.actives.map((a) => a.pct).join(" / ")}` : `Minimalist sells ${ing} at ${known.map((k) => k + "%").join(", ")}`;
      // Heuristic (eval run 2, relaunch ad "OAT EXTRACT 06% … you loved" -> "now … 6.5%"): a strength
      // that isn't in the current catalog may be the PREVIOUS formula. With no product page attached and
      // wording that points to an earlier version, ask a human to confirm instead of hard-blocking.
      const refersToOld = !ctx.sheet && /\b(previous(ly)?|formerly|old|earlier|used to|you loved|upgraded|reformulated|now|new and improved)\b/i.test(text);
      out.push(finding(rule, field, text, m.index, m.index + m[0].length, {
        message: `${rule.message} Stated ${pct}% but ${where}.${refersToOld ? " The ad seems to refer to an earlier formula — confirm, and label it clearly as the previous version." : ""}`,
        ...(refersToOld ? { severity: "fix", note: "Lowered to fix: wording suggests a previous formula (heuristic)." } : {}),
      }));
    }
    return out;
  },

  spf_mismatch(rule, field, text, ctx) {
    const out = [];
    // Every product SHOWN in the ad counts (range guide with SPF 50 + SPF 60 is not a mismatch).
    const shown = ctx.sheet ? [ctx.sheet, ...(ctx.extraSheets || [])] : [];
    const known = shown.length ? shown.flatMap((s) => s.actives.filter((a) => a.name === "SPF").map((a) => a.pct)) : null;
    const catalogSpfs = ["30", "50", "60"]; // from snapshot titles (SPF 30 / 50 / 60)
    // Also catches "SPF obtained: 56" / "SPF value obtained : 56" (missed before, 2026-10-03).
    // User rule: the labelled SPF is the claim; a measured value belongs only in the footnote.
    for (const m of text.matchAll(/\bSPF(?:\s+(?:value\s+)?(?:obtained|measured|tested))?\s*:?\s*(\d{1,3})\+?/gi)) {
      const n = m[1];
      const bad = known && known.length ? !known.includes(n) : !catalogSpfs.includes(n);
      if (!bad) continue;
      // The product page's own lab result (e.g. labelled SPF 50, "SPF value obtained: 56"): fine as a test
      // result in the footnote, a must-fix if used as the claim (found on the generator stand-in test).
      const measured = ctx.sheet && ctx.sheet.facts.some((f) => f.kind === "study" || f.kind === "claim" ? new RegExp(`\\b(spf|value)[^.]{0,30}\\b${n}\\b`, "i").test(f.text) : false);
      if (measured) {
        // User rule (2026-10-03): lab results go in the footnote, UNLESS lab results are the brief's main
        // theme (ctx.labTheme) — then a labelled lab row is fine, provided the labelled SPF is also stated.
        const labelledShown = known.some((k) => new RegExp(`\\bSPF\\s?${k}\\b`, "i").test(ctx.fullText || text));
        const allowed = field === "footnote" || (ctx.labTheme && labelledShown);
        out.push(finding(rule, field, text, m.index, m.index + m[0].length, {
          severity: allowed ? "advisory" : "fix",
          message: field === "footnote" ? `SPF ${n} is the lab-measured value; fine in the footnote as the test result.` : `SPF ${n} is the lab-measured value; the labelled SPF is ${known.join("/")}. House rule: claim SPF ${known.join("/")}, keep the measured value in the footnote only.`,
          fix: `Claim the labelled SPF ${known.join("/")}; keep 'SPF ${n} obtained (ISO 24444:2019)' as the test result in the footnote.`,
        }));
        continue;
      }
      out.push(finding(rule, field, text, m.index, m.index + m[0].length, {
        message: known && known.length ? `${rule.message} Ad says SPF ${n}; product is SPF ${known.join("/")}.` : `${rule.message} No Minimalist product is SPF ${n}.`,
        severity: known && known.length ? "block" : "fix",
      }));
    }
    return out;
  },

  // Hero active mentioned with no % anywhere near it. One finding per ad field at most.
  active_without_pct(rule, field, text, ctx) {
    if (field === "cta" || field === "footnote") return [];
    const names = ctx.sheet ? ctx.sheet.actives.filter((a) => a.name !== "SPF").map((a) => a.name.split(/\s*\+\s*/)[0]) : [];
    for (const n of names) {
      const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const m = text.match(re);
      if (!m) continue;
      const near = text.slice(Math.max(0, m.index - 12), m.index + m[0].length + 14);
      if (!/\d\s?%/.test(near)) return [finding(rule, field, text, m.index, m.index + m[0].length)];
    }
    return [];
  },

  // A count of emoji across the ad. Brand-authored copy on the site uses essentially none.
  emoji_density(rule, field, text) {
    const em = [...text.matchAll(/\p{Extended_Pictographic}/gu)];
    if (em.length < (rule.threshold || 2)) return [];
    return [finding(rule, field, text, em[0].index, em[0].index + em[0][0].length, { message: `${rule.message} (${em.length} emoji in ${field}).` })];
  },

  // OFR-01 (2026-10-03): every price / discount figure on the ad must appear in the dated offer capture
  // (sheet facts of kind price/offer, from scripts/collect_offers.js). [placeholders] are skipped.
  // Without a product sheet (scoring an arbitrary ad) there is nothing to check against.
  offer_mismatch(rule, field, text, ctx) {
    if (!ctx.sheet) return [];
    const src = [ctx.sheet, ...(ctx.extraSheets || [])].flatMap((s) => s.facts.filter((f) => ["price", "offer"].includes(f.kind)).map((f) => f.text)).join(" ");
    const shown = new Set([...src.matchAll(/(\d[\d,]*(?:\.\d+)?)/g)].map((m) => m[1].replace(/,/g, "")));
    const out = [];
    const re = /(?:Rs\.?|₹|INR)\s?(\d[\d,]*(?:\.\d+)?)|\b(\d{1,2})\s?%\s?(?:off|discount|savings?|below MRP)\b|\b(?:up\s?to|upto|flat|extra|additional|save)\s+(?:an?\s+)?(?:additional\s+)?(?:up\s?to\s+)?(\d{1,2})\s?%/gi;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      if ((before.match(/\[/g) || []).length > (before.match(/\]/g) || []).length) continue; // inside [placeholder]
      const n = (m[1] || m[2] || m[3]).replace(/,/g, "");
      if (shown.has(n)) continue;
      out.push(finding(rule, field, text, m.index, m.index + m[0].length, { message: `${rule.message} "${m[0]}" — captured figures: ${[...shown].slice(0, 12).join(", ") || "none (run scripts/collect_offers.js)"}.` }));
    }
    return out;
  },

  // OFR-03: urgency/scarcity is allowed only when the capture shows a real end date for an offer.
  false_urgency(rule, field, text, ctx) {
    const re = /\b(today only|only today|ends? (tonight|today|soon|midnight)|last (chance|day)|hurry|limited[- ](time|period|stock)|while stocks? lasts?|only \d+ left|selling fast|almost gone|don'?t miss out)\b/gi;
    const hasExpiry = ctx.sheet && ctx.sheet.facts.some((f) => f.kind === "offer" && !/no end date shown/.test(f.text));
    if (hasExpiry) return [];
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      // "it's almost gone" about acne marks is a result, not scarcity (customer-quote card, 2026-10-04). A result claim
      // is the claims rules' and the judge's business.
      if (/almost gone/i.test(m[0]) && /\b(it'?s|they'?re|marks?|scars?|spots?|acne|pimples?|tone|lines|wrinkles)\b/i.test(sentenceAround(text, m.index, m.index + m[0].length))) continue;
      out.push(finding(rule, field, text, m.index, m.index + m[0].length));
    }
    return out;
  },

  exclamation_density(rule, field, text) {
    const ex = [...text.matchAll(/!/g)];
    if (ex.length < (rule.threshold || 2)) return [];
    return [finding(rule, field, text, ex[0].index, ex[0].index + 1, { message: `${rule.message} (${ex.length} exclamation marks in ${field}).` })];
  },
};

function sameIngredient(ing, sheet) {
  if (!sheet) return false;
  const a = ing.toLowerCase();
  return sheet.actives.some((x) => x.name.toLowerCase().split(/\s*\+\s*/).some((t) => t && (a.includes(t.toLowerCase()) || t.toLowerCase().includes(a))));
}

// Ad-level checks that look at the whole ad, not a field.
function adLevel(ad, ctx) {
  const out = [];
  const all = FIELDS.map((f) => ad[f] || "").join("\n");
  const disclose = RULE_INDEX.get("CRE-01");
  if (disclose && ad.ad_type === "creator") {
    // Three levels (matches the independent reviewer's labels): missing -> block; present but only
    // after Meta's ~125-char "See more" cut -> fix (ASCI: upfront, not buried in hashtags); upfront -> ok.
    const re = /#ad\b|#sponsored|paid partnership|#collab\w*|\bsponsored\b|\bad\s*\|/i;
    const text = ad.primary_text || "";
    const m = text.match(re);
    if (!re.test(all)) {
      out.push({ ...finding(disclose, "primary_text", text, 0, 0), span: "" });
    } else if (m && m.index > 125 && !re.test(ad.headline || "") && !re.test(ad.on_image_text || "")) {
      out.push(finding(disclose, "primary_text", text, m.index, m.index + m[0].length, {
        severity: "fix",
        message: "Disclosure is there but only after the caption's 'See more' cut-off, so most viewers won't see it.",
        fix: "Move '#ad' / 'Paid partnership' to the start of the caption.",
      }));
    }
  }
  // AI-01 (ASCI synthetic-content guideline, 2026): only when the caller says what is AI-made — the scorer can't see
  // pixels. ctx.synthetic = { people, voice, setting, result, label_drawn } (any truthy part = AI shapes the ad).
  const ai = RULE_INDEX.get("AI-01");
  const syn = ctx.synthetic || ad.synthetic;
  if (ai && syn && (syn.people || syn.voice || syn.setting || syn.result)) {
    const label = /\b(created|generated|enhanced|made)\s+(using|with|by)\s+AI\b|\bAI[- ]generated\b|\bAI illustration\b/i;
    const where = ["on_image_text", "footnote", "headline"].find((f) => label.test(ad[f] || ""));
    // Prohibited even with a label: an AI result image, or an AI person/voice giving a first-person testimonial.
    const firstPerson = /\b(I|I'?ve|my|me)\b[^.?!]{0,80}\b(skin|acne|spots?|marks?|results?|glow|love|recommend|use|using|tried)\b/i;
    const tf = ["on_image_text", "headline", "primary_text"].find((f) => firstPerson.test(ad[f] || ""));
    if (syn.result || ((syn.people || syn.voice) && tf)) {
      const f = syn.result ? "on_image_text" : tf;
      const m = syn.result ? null : (ad[f] || "").match(firstPerson);
      out.push(finding(ai, f, ad[f] || "", m ? m.index : 0, m ? m.index + m[0].length : 0, {
        // DEC-07 (2026-10-05): never blocked; a clear warning, and the ad keeps its Severe risk rating.
        severity: "advisory", decision: "DEC-07", note: "AI-made image: shown with a warning and rated Severe (DEC-07). Replace with real, consented photos before use.",
        title: "AI-generated result or testimonial",
        message: syn.result
          ? "An AI-made image shows a product result. ASCI's synthetic-content guideline prohibits this even with a label."
          : "An AI-generated person or voice delivers a first-person testimonial. ASCI's synthetic-content guideline treats this as a fabricated testimonial, prohibited even with a label.",
        ...(m ? {} : { span: "" }),
      }));
    } else if (!where && !syn.label_drawn) {
      out.push({ ...finding(ai, "on_image_text", ad.on_image_text || "", 0, 0), span: "" });
    }
  }
  // OFR-04: an ad that shows an offer needs a terms line ("T&C apply" / conditions) somewhere on it.
  const terms = RULE_INDEX.get("OFR-04");
  const offerRe = /\b\d{1,2}\s?%\s?(off|discount)|\bup\s?to\s+\d{1,2}\s?%|\bbuy \d+,? get\b|\bfree (gift|\w+ on)|\bfreebies?\b|\bcoupon\b|\buse code\b|\bbelow MRP\b|\bsave (rs\.?|₹)?\s?\d/i;
  if (terms && offerRe.test(all) && !/T\s?&\s?Cs?\b|terms( and conditions)? apply|conditions apply|\bT&C\b/i.test(all)) {
    const field = FIELDS.find((f) => offerRe.test(ad[f] || ""));
    const m = (ad[field] || "").match(offerRe);
    // "Buy any 2 … get a freebie" states its own condition (CCPA-7 "extent of commitment"): advisory only.
    const selfStated = /\bbuy (any )?\d+\b|\bon orders? (above|over)\b/i.test(all) && !/\d{1,2}\s?%|\bcode\b|\bcoupon\b/i.test(all);
    out.push(finding(terms, field, ad[field], m.index, m.index + m[0].length, selfStated ? { severity: "advisory", message: "Offer states its condition; a 'T&C apply' line is still good practice." } : {}));
  }
  return out;
}

export function runRules(ad, ctx = {}) {
  const findings = [];
  const isCreator = ad.ad_type === "creator";
  // Fix after the out-of-distribution eval (2026-10-03): catalog checks compare stated strengths / SPF with
  // MINIMALIST's catalog, so on another brand's ad ("Glycolic Bright 8%") they fired as false blocks (most of the
  // 5/12 over-severity). They now run only for Minimalist's own ads or when a Minimalist product page is attached.
  const otherBrand = Boolean(ad.advertiser) && !/minimalist/i.test(ad.advertiser) && !ctx.sheet;
  const CATALOG_CHECKS = new Set(["concentration_mismatch", "spf_mismatch"]);
  for (const field of FIELDS) {
    const text = ad[field] || "";
    if (!text.trim()) continue;
    const masked = maskProductNames(text, [ad.advertiser, ...(ctx.brandNames || [])]);
    for (const rule of RULES.rules) {
      if (rule.applies_to && !rule.applies_to.includes(field)) continue;
      let hits = [];
      if (rule.computed) {
        if (COMPUTED[rule.computed] && !(otherBrand && CATALOG_CHECKS.has(rule.computed))) hits = COMPUTED[rule.computed](rule, field, text, ctx);
      } else if (rule.patterns) {
        for (const p of rule.patterns) {
          const re = new RegExp(p, "giu");
          let m;
          while ((m = re.exec(masked))) {
            if (m[0].length === 0) { re.lastIndex++; continue; }
            const sent = sentenceAround(text, m.index, m.index + m[0].length);
            if (rule.unless_same_sentence && rule.unless_same_sentence.some((u) => new RegExp(u, "iu").test(sent))) continue;
            hits.push(finding(rule, field, text, m.index, m.index + m[0].length, { sentence: sent }));
          }
        }
      }
      for (const h of hits) {
        if (isCreator && rule.creator_severity) {
          if (rule.creator_severity === "skip") continue;
          h.severity = rule.creator_severity;
          h.note = "Creator-voice ad: tone rule relaxed.";
        }
        // Listing claims are lowered one step (the brand has published them); a reviewer still confirms substantiation.
        // PAGE_DENY lists any claim type legal wants kept at full severity regardless.
        if (rule.provenance === "downgrade" && ctx.sheet && !PAGE_DENY.has(rule.id)) {
          const prov = findProvenance(h.sentence || h.span, ctx.sheet);
          if (prov) {
            h.severity = lower(h.severity);
            h.provenance = prov.id;
            h.note = `Wording appears on the product page (${prov.id}). Severity lowered one step: the brand has published it, but a reviewer must still confirm substantiation is on file.`;
          }
        }
        applyDecisions(h);
        findings.push(h);
      }
    }
  }
  // Ad-level checks (creator disclosure, AI content, offer terms) get the brand decisions too (DEC-07: AI images warn).
  findings.push(...adLevel(ad, ctx).map((h) => applyDecisions(h)));
  return dedupe(findings);
}

// Same rule, same field, overlapping span -> keep one.
function dedupe(fs_) {
  const out = [];
  for (const f of fs_) {
    if (out.some((g) => g.rule_id === f.rule_id && g.field === f.field && f.start < g.end && g.start < f.end)) continue;
    out.push(f);
  }
  return out;
}

export { SEV_ORDER };
