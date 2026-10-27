// Ad generator: fact sheet -> copy -> every format the product can fill (lib/app_formats.js) -> self-score.
//
// Two modes:
//  - "model": the model writes copy that must cite fact ids; code checks every number against the
//    cited facts and every citation id against the sheet. One automatic revision if the self-score
//    blocks; never more (a loop that rewrites until the scorer is happy optimises against the scorer).
//  - "verbatim": no API key needed. Lines are picked from the page facts word for word. Duller,
//    but it cannot invent a claim — which is the failure that costs money.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refusalReason } from "./extract.js";
import { structuredCall, loadPrompt, llmAvailable } from "./llm.js";
import { scoreAd, verdictFor } from "./score.js";
import { runRules } from "./rules.js";
import { layoutProblems } from "../public/render.js";
import { NEG } from "./reviews.js";
import { libraryFor } from "./library.js";
import { handleOf, requestHandle } from "./live_facts.js";
import { audiences } from "./app_formats.js";
import { FORMATS, IMAGE_FORMATS, packVisual, buildFormat, listFormats, pickQuote, pickStat, textureOf, badgesOf } from "./app_formats.js";
import { queueImageRequest, imageRequests } from "./library.js";

export { FORMATS, pickQuote, pickStat, textureOf, badgesOf };

// The product name IS citable: it's the pack, and it's the source of the concentration ("2% Granactive
// Retinoid"). Banning it blocked 10 of 12 pipeline briefs on the first gate run.
const NOT_CITABLE = new Set(["testimonial", "faq", "inci"]);
// Prices, offers, the rating and reviews are for the offer / price / rating / quote formats, which quote them exactly;
// the copywriter never sees them (2026-10-05: they joined the fact sheet with the app's new formats).
const LIVE_KINDS = new Set(["price", "offer", "rating", "review"]);
const CTAS = ["Shop now", "Learn more", "See ingredients"];

export const COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "subhead", "proof_points", "footnote", "cta", "citations"],
  properties: {
    headline: { type: "string" },
    subhead: { type: "string" },
    proof_points: { type: "array", items: { type: "string" } },
    footnote: { type: "string" },
    cta: { type: "string", enum: CTAS },
    citations: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "subhead", "proof_points", "footnote"],
      properties: {
        headline: { type: "array", items: { type: "string" } },
        subhead: { type: "array", items: { type: "string" } },
        proof_points: { type: "array", items: { type: "array", items: { type: "string" } } },
        footnote: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const nums = (s) => (String(s).match(/\d+(?:\.\d+)?/g) || []).map((n) => n.replace(/^0+(?=\d)/, ""));

// Every number in a line must appear in the facts it cites (or the product title).
export function checkCopy(copy, sheet) {
  const problems = [];
  const byId = new Map(sheet.facts.map((f) => [f.id, f]));
  const titleNums = new Set(nums(sheet.title));
  const lines = [
    ["headline", copy.headline, copy.citations.headline],
    ["subhead", copy.subhead, copy.citations.subhead],
    ...copy.proof_points.map((p, i) => [`proof point ${i + 1}`, p, copy.citations.proof_points[i] || []]),
    ["footnote", copy.footnote, copy.citations.footnote],
  ];
  for (const [label, text, cites] of lines) {
    if (!text || !text.trim()) continue;
    if (!cites || cites.length === 0) {
      problems.push(`${label} has no citation`);
      continue;
    }
    const facts = cites.map((id) => byId.get(id));
    if (facts.some((f) => !f)) problems.push(`${label} cites an id that doesn't exist (${cites.join(", ")})`);
    const bad = facts.filter((f) => f && NOT_CITABLE.has(f.kind));
    if (bad.length) problems.push(`${label} cites ${bad.map((f) => `${f.id} (${f.kind})`).join(", ")}, which can't support a claim`);
    const allowed = new Set([...titleNums, ...facts.filter(Boolean).flatMap((f) => nums(f.text))]);
    const extra = nums(text).filter((n) => !allowed.has(n));
    if (extra.length) problems.push(`${label} uses number(s) ${extra.join(", ")} not found in its cited facts`);
  }
  if (copy.proof_points.length > 3) problems.push("more than 3 proof points");
  return problems;
}

// ---------- what the library already holds for this product (2026-10-05: "new ads are loading the previously made ones") ----------
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}% ]+/gu, " ").replace(/\s+/g, " ").trim();
// [{ format, headline }] for every existing ad of the product: the "Headline:" line on the creative, else its first line.
export function existingHeadlines(handle) {
  if (!handle || !/^[a-z0-9-]+$/i.test(handle)) return [];
  const out = [];
  try {
    for (const g of libraryFor(handle).groups) for (const ad of g.ads) {
      const line = ad.on_image.find((l) => /^headline:/i.test(l));
      const text = line ? line.replace(/^headline:\s*/i, "") : ad.on_image[0];
      if (text) out.push({ format: g.format, headline: text });
    }
  } catch { /* no library yet */ }
  return out;
}

// Deterministic copy: whole facts only (no truncation: cutting a sentence can change its meaning). `variant` (1, 2, 3 ... one
// per Build) rotates through the usable page facts so every Build reads differently; `avoid` is the headlines the library
// already has: a candidate equal to one is skipped while another exists. Variant 0 / 1 = the first pick.
export function verbatimCopy(sheet, variant = 0, avoid = []) {
  const off = Math.max(0, Math.floor(Number(variant) || 0) - 1);
  const rot = (list) => (list.length ? [...list.slice(off % list.length), ...list.slice(0, off % list.length)] : list);
  const used = new Set(avoid.map(norm));
  const usable = sheet.facts.filter((f) => !NOT_CITABLE.has(f.kind) && !LIVE_KINDS.has(f.kind));
  // Reviews (lib/reviews.js screen: verified, no negative wording) join the pool only as short whole quotes already on the sheet.
  const reviews = sheet.facts.filter((f) => f.kind === "review" && f.text.length <= 120 && !NEG.test(f.text));
  const taken = new Set();
  const take = (f) => (f ? (taken.add(f.id), f) : null);
  const firstSentence = (t) => (t.match(/^[^.]*\./) || [t])[0].trim();
  // A line the rule layer flags at fix / block (e.g. a hair-fall claim) is never picked as copy. Run WITHOUT the page as context: with it, a claim the page itself makes is downgraded to advisory, which is exactly what must not be auto-picked.
  const clean = (f) => !runRules({ ad_type: "brand", headline: f.text, primary_text: "", on_image_text: "", footnote: "", cta: "" }, {}).some((x) => ["block", "fix"].includes(x.severity));
  const wholeShort = (f, max) => clean(f) && f.text.length <= max && !/^\d+%\s+subjects/i.test(f.text) && !/^note:/i.test(f.text);

  const headPool = rot(usable.filter((f) => ["claim", "suitability", "usage", "study"].includes(f.kind) && wholeShort(f, 60)));
  const headline = take(headPool.find((f) => !used.has(norm(f.text))) || headPool[0]) || { id: sheet.facts[0].id, text: sheet.title };
  const subPool = rot([...usable.filter((f) => ["claim", "suitability", "usage"].includes(f.kind) && wholeShort(f, 120) && firstSentence(f.text) === f.text), ...reviews]).filter((f) => !taken.has(f.id));
  const sub = take(subPool.find((f) => !used.has(norm(f.text))) || subPool[0]);
  const proofPool = rot(usable.filter((f) => ["claim", "suitability", "usage"].includes(f.kind) && wholeShort(f, 70))).filter((f) => !taken.has(f.id));
  const proofs = proofPool.slice(0, 3).map(take);
  const safety = usable.find((f) => f.kind === "study" && /patch test/i.test(f.text) && f.text.length <= 200);
  return {
    headline: headline.text,
    subhead: sub ? sub.text : "",
    proof_points: proofs.map((f) => f.text),
    footnote: safety ? safety.text.replace(/^Note:\s*/i, "") : "",
    cta: "Shop now",
    citations: {
      headline: [headline.id],
      subhead: sub ? [sub.id] : [],
      proof_points: proofs.map((f) => [f.id]),
      footnote: safety ? [safety.id] : [],
    },
  };
}

function factsBlock(sheet) {
  return sheet.facts
    .filter((f) => f.kind !== "inci" && !LIVE_KINDS.has(f.kind))
    .map((f) => `${f.id} [${f.kind}] (${f.section}) ${f.text}`)
    .join("\n");
}

function heroOf(sheet) {
  const a = sheet.actives[0];
  return a ? { pct: a.pct, name: a.name } : null;
}

// stand_in/<kind>/<name>.json, written by a Claude agent when no API key is set.
function standIn(kind, name) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "stand_in", kind, `${name}.json`), "utf8").replace(/^﻿/, "")); } catch { return null; }
}
export function generatorUserPrompt(sheet, revision = "", avoid = [], variant = 0) {
  const hero = heroOf(sheet);
  return loadPrompt("generator_user.md", {
      TITLE: sheet.title,
      HERO: hero ? `${hero.pct} ${hero.name}` : "(none — no concentration in the title)",
      URL: sheet.url || "(manual entry)",
      FACTS: factsBlock(sheet),
      AVOID: avoid.length ? `\nDo not repeat these existing headlines (write a different angle${variant > 1 ? `, variant ${variant}` : ""}):\n${avoid.map((h) => `- ${h}`).join("\n")}\n` : "",
      REVISION: revision ? `\nReviewer findings on your previous draft — fix all of them:\n${revision}\n` : "",
    });
}
async function modelCopy(sheet, revision = "", avoid = [], variant = 0) {
  const hero = heroOf(sheet);
  const { data } = await structuredCall({
    system: loadPrompt("generator_system.md"),
    user: loadPrompt("generator_user.md", {
      TITLE: sheet.title,
      HERO: hero ? `${hero.pct} ${hero.name}` : "(none — no concentration in the title)",
      URL: sheet.url || "(manual entry)",
      FACTS: factsBlock(sheet),
      AVOID: avoid.length ? `\nDo not repeat these existing headlines (write a different angle${variant > 1 ? `, variant ${variant}` : ""}):\n${avoid.map((h) => `- ${h}`).join("\n")}\n` : "",
      REVISION: revision ? `\nReviewer findings on your previous draft — fix all of them:\n${revision}\n` : "",
    }),
    schema: COPY_SCHEMA,
    effort: "medium",
  });
  return data;
}

// ---------- formats (2026-10-05: every format that fits, ranked, all clickable; see lib/app_formats.js) ----------
// Kept for older callers: one row per format with available = ready to export once checked.
export function formatOptions(copy, sheet, inputs = {}) {
  const { built, notShown } = listFormats(copy, sheet, inputs);
  return [
    ...built.map((b) => ({ ...b.meta, available: b.meta.status === "ready", why: b.meta.missing.length ? `Needs ${b.meta.missing.join(", ")}.` : "" })),
    ...notShown.filter((n) => FORMATS.some((f) => f.id === n.id)).map((n) => ({ id: n.id, label: n.label, available: false, status: "not_fit", why: `Not offered: ${n.why}.` })),
  ];
}

// The render spec (public/render.js) and the ad as the scorer sees it, for one format. A format the product can't fill
// honestly falls back to the product hero.
const built = (copy, sheet, format, inputs) => { const b = buildFormat(format, copy, sheet, inputs); return b.notFit ? buildFormat("hero", copy, sheet, inputs) : b; };
export const specFromCopy = (copy, sheet, format = "hero", inputs = {}) => built(copy, sheet, format, inputs).spec;
export const adFromCopy = (copy, sheet, format = "hero", inputs = {}) => built(copy, sheet, format, inputs).ad;

// Scores one built format and folds in what the app itself knows: the layout check and lines typed without a source.
export async function scoreBuilt(b, sheet, { rulesOnly = false } = {}) {
  // No Claude key: a stand-in AI judge answer for this product and format (the exact judge prompt, answered by a Claude
  // agent; scripts/stand_in_prompts.mjs) is used as the model layer, the same way the library pipeline uses judge/<id>.json.
  const sj = !llmAvailable() && standIn("judge", `${handleOf(sheet)}__${b.id || b.meta?.id}`);
  const report = await scoreAd(b.ad, { sheet, extraSheets: b.extraSheets, rulesOnly: sj ? false : rulesOnly, layout: b.spec.layout, template_id: b.meta.template?.id, ...(sj ? { injectModelData: sj, injectModelName: "stand-in (same prompt)" } : {}) });
  const extra = [];
  if (b.layout.length) extra.push({ rule_id: "LAYOUT", dimension: "language", severity: "block", title: "Copy doesn't fit the layout", field: "headline", start: 0, end: 0, span: "", message: b.layout.join(" "), fix: "Shorten the copy.", sources: [], confidence: "layout check", layer: "rule" });
  for (const t of b.meta.typed) extra.push({ rule_id: "UNSOURCED", dimension: "policy", severity: "fix", title: "Line typed in the app, no page source", field: "on_image_text", start: 0, end: 0, span: t.text, message: `"${t.label}" was typed in the app, so nothing on the product page backs it yet.`, fix: "Attach the source (page fact, study, offer terms) or use a line from the page.", sources: [], confidence: "app check", layer: "rule" });
  // Another brand's ad is compared with Minimalist's voice only as a reference; rules and policy apply in full.
  if (sheet?.brand_site === "other") for (const p of report.scores?.alignment?.parts || []) if (/voice|tone|language/i.test(p.name) && !/^brand voice:/i.test(p.name)) p.name = `brand voice: Minimalist reference (${p.name})`;
  if (extra.length) {
    report.findings.unshift(...extra);
    report.verdict = verdictFor(report.findings, report.coverage);
  }
  return report;
}

// One format, ready for the app: spec + report + what it still needs.
export async function formatItem(copy, sheet, format, inputs = {}, opts = {}) {
  const b = buildFormat(format, copy, sheet, inputs);
  if (b.notFit) throw new Error(`This product can't fill the ${format} format: ${b.notFit}.`);
  return { format, meta: b.meta, spec: b.spec, report: await scoreBuilt(b, sheet, opts), layout_problems: b.layout };
}

// Every format, rules-only (instant): the app shows the first at once and asks the AI judge per format afterwards.
export async function allFormats(copy, sheet, inputs = {}) {
  const { built: all, notShown } = listFormats(copy, sheet, inputs);
  // A format with empty slots is never an ad in the grid: it is listed as not offered (with a fill-in link in the app).
  const list = all.filter((b) => b.meta.status !== "needs_input"), drafts = all.filter((b) => b.meta.status === "needs_input");
  for (const d of drafts) notShown.push({ id: d.id, label: d.meta.label, why: `needs ${d.meta.missing.join(", ")}`, draft: true });
  const items = {};
  for (const b of all) items[b.id] = { spec: b.spec, report: await scoreBuilt(b, sheet, { rulesOnly: true }), layout_problems: b.layout };
  // Pediatrics (lib/extract.js refusalReason): every format is made but rated Severe, so export stays off.
  const severe = refusalReason(sheet);
  if (severe) for (const b of all) Object.assign(b.meta, { risk: "severe", risk_label: "Severe", risk_note: `${severe} ${b.meta.risk_note || ""}`.trim() });
  return { formats: list.map((b) => b.meta), drafts: drafts.map((b) => b.meta), notShown, items, severe };
}

const findingsAsText = (report) =>
  report.findings
    .filter((f) => f.severity !== "advisory")
    .map((f) => `- [${f.severity}] ${f.rule_id} "${f.span}": ${f.message} Suggested: ${f.fix}`)
    .join("\n");

// One fresh image request per AI-image format, per Build (user, 2026-10-05: no old images when creating from scratch).
// Returns { <format id>: <request id> }. A format that can't be queued (no beminimalist.co handle) is simply left out: its card says so.
export function queueFreshImages(copy, sheet, variant = 0) {
  const handle = requestHandle(sheet), requests = {};
  // 1. The product image first (user, 2026-10-05: "after the product image is rendered correctly we send the request for
  // rest of the images"): a Minimalist product with no verified render gets a studio render of the real pack,
  // label-checked against the page photo. A render already queued or in progress for this product is reused.
  const pv = handle ? packVisual(handle, sheet) : null;
  if (handle && !pv?.file && pv?.source !== "label-checked studio render") {
    const live = imageRequests(handle).find((r) => r.format === "render" && ["queued", "working"].includes(r.status));
    if (live) requests.render = live.id;
    else try { requests.render = queueImageRequest(handle, `Create an image: a clean studio product shot of the attached pack standing upright on a plain white background with a soft shadow, vertical 2:3 (${sheet.title}).`, sheet, { format: "render" }).id; } catch { /* no handle */ }
  }
  // 2. Every other new image waits for that render ("after"); the worker sends it once the render has a result and
  // attaches the passed render as the product photo.
  for (const id of IMAGE_FORMATS) {
    const b = buildFormat(id, copy, sheet, { fresh: true, variant });
    if (b.notFit || !b.meta.image_need) continue;
    try { requests[id] = queueImageRequest(handle, b.meta.image_need.prompt, sheet, { format: id, textOnly: b.meta.image_need.base === "none", after: requests.render }).id; } catch { /* no handle: left out */ }
  }
  return requests;
}

export async function generateAd(sheet, opts = {}) {
  if (!sheet || !sheet.facts) throw new Error("No product facts. Extract the product first.");

  const variant = Math.max(0, Math.floor(Number(opts.variant) || 0));
  const avoid = [...new Set(existingHeadlines(handleOf(sheet)).map((e) => e.headline))];
  const mode = opts.mode === "verbatim" || !llmAvailable() ? "verbatim" : "model";
  const log = [];
  let copy;
  if (mode === "model") {
    try {
      copy = await modelCopy(sheet, "", avoid, variant);
      let problems = [...checkCopy(copy, sheet), ...layoutProblems(specFromCopy(copy, sheet))];
      if (problems.length) {
        log.push({ step: "draft rejected by code checks", problems });
        copy = await modelCopy(sheet, problems.map((p) => `- ${p}`).join("\n"), avoid, variant);
        problems = [...checkCopy(copy, sheet), ...layoutProblems(specFromCopy(copy, sheet))];
        if (problems.length) {
          log.push({ step: "revision still failed code checks; fell back to verbatim copy", problems });
          copy = verbatimCopy(sheet, variant, avoid);
        }
      }
    } catch (e) {
      log.push({ step: "model unavailable; fell back to verbatim copy", error: e.message });
      copy = verbatimCopy(sheet, variant, avoid);
    }
  } else if (!llmAvailable() && standIn("copy", handleOf(sheet))) {
    // No Claude key: a Claude agent answered the exact generator prompt (scripts/stand_in_prompts.mjs) and its copy
    // passes the same code checks as the API's would (user, 2026-10-05: "all those queries where claude api is needed u solve for those for now").
    const sc = standIn("copy", handleOf(sheet));
    const problems = [...checkCopy(sc, sheet), ...layoutProblems(specFromCopy(sc, sheet))];
    if (problems.length) { log.push({ step: "stand-in copy failed code checks; verbatim copy used", problems }); copy = verbatimCopy(sheet, variant, avoid); }
    else { copy = sc; log.push({ step: "copy written by a Claude stand-in on the exact generator prompt (no API key)" }); }
  } else {
    copy = verbatimCopy(sheet, variant, avoid);
  }

  // Self-check on the product hero with the rules (instant). The AI judge then reads every format separately in the
  // app (one /api/rescore per format), so it isn't run twice here (2026-10-05: progressive rendering).
  let report = await scoreAd(adFromCopy(copy, sheet, "hero"), { sheet, rulesOnly: true });
  if (mode === "model" && report.verdict.code === "BLOCKED" && !log.some((l) => /fell back/.test(l.step))) {
    log.push({ step: "self-score blocked the first draft; one revision requested", findings: report.findings.filter((f) => f.severity === "block").map((f) => f.rule_id) });
    try {
      const revised = await modelCopy(sheet, findingsAsText(report), avoid, variant);
      if (checkCopy(revised, sheet).length === 0 && layoutProblems(specFromCopy(revised, sheet)).length === 0) copy = revised;
      else log.push({ step: "revision failed code checks; kept first draft" });
    } catch (e) {
      log.push({ step: "revision call failed", error: e.message });
    }
  }

  const requests = opts.queue === false ? {} : queueFreshImages(copy, sheet, variant);
  const all = await allFormats(copy, sheet, { ...(opts.inputs || {}), variant, fresh: true, requests });
  // First shown: the top-ranked format that is ready (or the one asked for).
  const first = (opts.format && all.items[opts.format] && all.formats.find((f) => f.id === opts.format)?.status === "ready" && opts.format) || all.formats.find((f) => f.status === "ready")?.id || "hero";
  return { refused: false, audiences: audiences(sheet), mode, variant, requests, copy, log, format: first, spec: all.items[first].spec, report: all.items[first].report, ...all };
}


