// Composes the ad as an SVG string. Pure function, no DOM — runs in the browser and in Node tests.
//
// Layout decisions (see docs/DECISIONS.md):
//  - One placement: 1080x1080 (1:1). Works in Meta feed (FB/IG) and as a square asset for Google
//    Demand Gen / responsive display. More sizes = more layouts where the footnote can be cropped.
//  - The hero number (e.g. "10%" + "Niacinamide") is taken from the pack title, never from the model.
//  - The real product photo is used as-is (no generation, no retouching).
//  - Footnote is part of the creative, sized to stay legible (>= 20px at 1080) — a qualifier that
//    can't be read in feed is the same as no qualifier.

export const SIZE = { w: 1080, h: 1080 };

const C = {
  // White canvas (was warm #F4F2EE): the brand's top-running statics are white or very light grey with black type
  // and one grey (ad_style_top_runners.md; user review 2026-10-04: "the design should be minimalistic").
  bg: "#FFFFFF",
  ink: "#111111",
  muted: "#6B6B6B",
  rule: "#E3E3E3",
  card: "#F6F6F6",
};
// 'Nirmala UI' (ships with Windows) + Noto fallbacks cover Devanagari, Tamil, Telugu, Bengali for language versions.
const FONT = "'Helvetica Neue', Helvetica, Arial, 'Nirmala UI', 'Noto Sans Devanagari', 'Noto Sans Tamil', 'Noto Sans Telugu', 'Noto Sans Bengali', sans-serif";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Visual length in "Latin character" units. Eye-check (Tamil pilot, 2026-10-03): Tamil/Telugu/Bengali glyph
// clusters are wider than Latin letters, so counting code points overflowed headlines, pills and the CTA.
export function vlen(text) {
  let n = 0;
  for (const ch of String(text || "")) {
    const c = ch.codePointAt(0);
    n += c >= 0x0b80 && c <= 0x0d7f ? 1.3 /* Tamil, Telugu, Kannada, Malayalam */ : c >= 0x0980 && c <= 0x09ff ? 1.15 /* Bengali */ : c >= 0x0900 && c <= 0x097f ? 1.0 : 1;
  }
  return n;
}

// Greedy wrap using an average glyph width; good enough for a sans at these sizes.
export function wrap(text, fontPx, maxPx, avg = 0.52) {
  const maxChars = Math.max(4, Math.floor(maxPx / (fontPx * avg)));
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (vlen(cur + " " + w) <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function textBlock(lines, x, y, size, lh, attrs) {
  return lines
    .map((l, i) => `<text x="${x}" y="${y + i * lh}" font-size="${size}" ${attrs}>${esc(l)}</text>`)
    .join("");
}

let BAND_Y = 820; // text must end above BAND_Y - 24 (measure/layoutProblems); the CTA now follows the content (see stack)
// Content zone (2026-10-05 whitespace pass): the pack fills ZT..ZB on the right, and the text stack + "Shop now" are centred
// in the same zone, so there is no empty band between the content and the CTA.
let ZT = 120, ZB = 880;
const CTA_GAP = 44, CTA_H = 32;
// Native 4:5 and 9:16 (user, 2026-10-27: "make sure every ad is present in these 2 dimensions and works well"; the
// structural fix from the other desk's ad reviews: "rebuild every 9:16 ... a 1:1 dropped into the top, with the bottom
// 40% blank"). Each size has its own zones; the layouts read them instead of fixed numbers, so the pack grows into
// the taller frame and nothing sits under the placement's UI. 9:16 keeps Meta's Stories/Reels zones clear: logo and
// copy below the top 14% (270 px) and above the bottom 35% (y 1248); the text stack sits high (headline in the
// upper part of the frame) rather than centred. The square values are the ones the layouts always used.
const FRAMES = {
  1080: { top: 72, zt: 120, zb: 880, band: 820, foot: 928, bias: 1 },
  1350: { top: 72, zt: 140, zb: 1150, band: 1090, foot: 1198, bias: 1 },
  1920: { top: 290, zt: 360, zb: 1160, band: 1100, foot: 1206, bias: 0.3 },
};
let FH = 1080, TOP = 72, FOOT_Y = 928, BIAS = 1;
function setFrame(H) {
  const fr = FRAMES[H] || FRAMES[1080];
  FH = FRAMES[H] ? H : 1080; TOP = fr.top; ZT = fr.zt; ZB = fr.zb; BAND_Y = fr.band; FOOT_Y = fr.foot; BIAS = fr.bias;
}
const PH = () => ZB - ZT; // the product zone height (760 on the square)
function stack(parts, draw, zb = ZB, zt = ZT) {
  const tp = [];
  const end = draw(tp, zt);
  const dy = Math.max(0, Math.round(((zb - zt - (end - zt) - CTA_GAP - CTA_H) / 2) * BIAS));
  parts.push(`<g transform="translate(0 ${dy})">${tp.join("")}</g>`);
  return { fit: end, cta: end + dy + CTA_GAP };
}
const FOOT_PX = 22; // was 26, then 24: the statics carry one short qualifier line at most (2 lines max, never cut: layoutProblems)

// spec: { hero: {pct, name}, headline, subhead, proofPoints[], footnote, cta, imageHref, productName }
// Text is laid out at scale 1, then shrunk in steps until the column fits above the bottom band.
// If it still doesn't fit at the minimum scale, the overflow is reported (layoutProblems) — the
// first render test (v1) showed proof points running into the CTA, and that must never export.
// spec.layout picks the format (research/ad_format_library.md): hero (default), actives, journey, stat,
// callouts, spec, range, offer, before_after. All share the same chrome: wordmark, CTA band, 26px
// footnote, internal-test mark — so the legal furniture is identical whichever format is used.
export const LAYOUTS = { hero: (spec, s) => layout(spec, s) };

function pick(spec) {
  return LAYOUTS[spec.layout || "hero"] || LAYOUTS.hero;
}

export function renderAdSvg(spec, H = 1080) {
  setFrame(H);
  try { return renderAt(spec); } finally { setFrame(1080); }
}
function renderAt(spec) {
  const fn = pick(spec);
  for (let s = 1; s >= 0.7; s -= 0.05) {
    const out = fn(spec, s);
    if (out.bottom <= BAND_Y - 24) return out.svg;
  }
  return fn(spec, 0.7).svg;
}

export function measure(spec, H = 1080) {
  setFrame(H);
  try { return measureAt(spec); } finally { setFrame(1080); }
}
function measureAt(spec) {
  const fn = pick(spec);
  for (let s = 1; s >= 0.7; s -= 0.05) {
    const out = fn(spec, s);
    if (out.bottom <= BAND_Y - 24) return { fits: true, scale: +s.toFixed(2), bottom: out.bottom };
  }
  return { fits: false, scale: 0.7, bottom: fn(spec, 0.7).bottom };
}

// Minimal house layout (user review 2026-10-04: "look at the style, it is much cleaner than what we are building … a
// lot of visuals, a lot of text … the design should be minimalistic"). Matches Minimalist's own top-running statics:
// white canvas, the real pack large on the right, one title + the product name + one small grey line beside it, at
// most one tag. No generated scene, no panels, no big % number (the pack and the product name carry the strength),
// no bullets: proof points belong in the caption (lib/brief_check.js leanBrief).
function layout(spec, s) {
  const { w } = SIZE;
  const colW = 430;
  const px = (n) => Math.round(n * s);
  const parts = [`<rect width="${w}" height="${FH}" fill="${spec.canvas || C.bg}"/>`, wordmark(PAD, spec)];
  if (spec.imageHref || spec.personHref) parts.push(productVisual(spec, 490, ZT, 550, PH()));
  const title = spec.headline || spec.productName || "";
  const hs = px(52), hl = px(60), head = wrap(title, hs, colW, 0.55).slice(0, 4);
  // The ingredient lockup (active + % in the pack's style) replaces the product-name line when it's shown.
  const showName = !spec.lockup && spec.productName && !title.toLowerCase().includes(spec.productName.toLowerCase());
  const ns = px(24), nl = px(30), name = showName ? wrap(spec.productName, ns, colW, 0.58) : [];
  const ss = px(23), sl = px(31), sub = spec.subhead ? wrap(spec.subhead, ss, colW) : [];
  const tagH = spec.tag ? 34 + px(24) : 0;
  const lkH = spec.lockup ? px(30) + lockupHeight(spec.lockup, s, colW) : 0;
  const height = tagH + hs + (head.length - 1) * hl + lkH + (name.length ? px(24) + name.length * nl : 0) + (sub.length ? px(16) + sub.length * sl : 0);
  // The text stack and the CTA are centred beside the pack, as in the brand's statics.
  const r = stack(parts, (tp, y) => {
    if (spec.tag) { tp.push(tagLabel(PAD, y, spec.tag)); y += tagH; }
    tp.push(T(head, PAD, y + hs, hs, hl, `font-weight="500" fill="${C.ink}"`));
    y += hs + (head.length - 1) * hl;
    if (spec.lockup) y = lockup(tp, spec.lockup, spec.accent, PAD, y + px(30), s, colW);
    if (name.length) { y += px(24); tp.push(T(name, PAD, y + ns, ns, nl, `font-weight="600" fill="${C.ink}"`)); y += ns + (name.length - 1) * nl; }
    if (sub.length) { y += px(16); tp.push(T(sub, PAD, y + ss, ss, sl, `fill="${C.muted}"`)); y += ss + (sub.length - 1) * sl; }
    return y;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
}

// Ingredient lockup in the brand's pack-label style (user review 2026-10-04: "the ingredient and its % bold and bigger
// ... the same style of ingredient presentation could be used in many images"). As printed on every Minimalist pack:
// the active in bold, then the product's thin accent-colour line with the strength in a light weight beside it.
// lk = {name, pct}; size "big" (single-product layouts) or "small" (under each pack in routine / range layouts).
// Returns the y below the block. align "middle" centres it on x (small lockups under packs).
export function lockupHeight(lk, s, maxW, size = "big") {
  if (!lk) return 0;
  const k = size === "big" ? { ns: 28, nl: 34, vs: 64, gap: 10 } : { ns: 16, nl: 20, vs: 26, gap: 4 };
  const lines = wrap(lk.name, Math.round(k.ns * s), maxW, 0.62).slice(0, 2).length;
  return Math.round(k.ns * s) + (lines - 1) * Math.round(k.nl * s) + Math.round(k.gap * s) + Math.round(k.vs * s);
}
function lockup(parts, lk, accent, x, y, s, maxW, size = "big", align = "start") {
  if (!lk) return y;
  // User review 2026-10-05: the line before the % was too long; shorter and broader, in the bottle's own colour.
  const k = size === "big" ? { ns: 28, nl: 34, vs: 64, gap: 10, line: 60, lh: 9 } : { ns: 16, nl: 20, vs: 26, gap: 4, line: 24, lh: 5 };
  const ns = Math.round(k.ns * s), vs = Math.round(k.vs * s), nl = Math.round(k.nl * s);
  const name = wrap(lk.name, ns, maxW, 0.62).slice(0, 2);
  const anchor = align === "middle" ? ' text-anchor="middle"' : "";
  parts.push(T(name, x, y + ns, ns, nl, `font-weight="700" fill="${C.ink}"${anchor}`));
  y += ns + (name.length - 1) * nl + Math.round(k.gap * s);
  const lineW = Math.round(k.line * s), pctW = Math.round(vlen(lk.pct) * vs * 0.52), total = lineW + 12 + pctW;
  const x0 = align === "middle" ? Math.round(x - total / 2) : x;
  parts.push(`<rect x="${x0}" y="${y + Math.round(vs * 0.62 - k.lh / 2)}" width="${lineW}" height="${k.lh}" rx="${Math.round(k.lh / 2)}" fill="${accent || C.ink}"/>`);
  parts.push(`<text x="${x0 + lineW + 12}" y="${y + vs - Math.round(vs * 0.12)}" font-family="${FONT}" font-size="${vs}" font-weight="300" letter-spacing="-1" fill="${C.ink}">${esc(lk.pct)}</text>`);
  return y + vs;
}

// One small black label at most (top-running statics: "Clinically Tested", "Updated" — only a page-stated fact).
function tagLabel(x, y, text) {
  const tw = Math.round(vlen(text) * 18 * 0.62) + 28;
  return `<rect x="${x}" y="${y}" width="${tw}" height="34" fill="${C.ink}"/><text x="${x + 14}" y="${y + 23}" font-family="${FONT}" font-size="18" font-weight="700" fill="#FFFFFF">${esc(text)}</text>`;
}
// ---------------- format library layouts ----------------

const PAD = 72;
const T = (lines, x, y, size, lh, attrs) => textBlock(lines, x, y, size, lh, `font-family="${FONT}" ${attrs}`);

// White canvas + wordmark. Minimal house look (user review 2026-10-04): generated scene backgrounds and the translucent
// panels that kept copy legible over them are gone; the brand's statics are plain white with the real pack as the hero.
// (A generated background is still accepted by the pipeline but no longer drawn.)
function chromeStart(spec, panel) {
  const { w } = SIZE, h = FH;
  return [`<rect width="${w}" height="${h}" fill="${spec.canvas || C.bg}"/>`, wordmark(PAD, spec)];
}

// Wordmark with the brand's sign-off underneath, as in its own lockup. User review (2026-10-04: "hide nothing tg is
// missing"): "Hide Nothing." sits under the logo on the end card of Minimalist's two longest-running ads (121 days)
// and on its Amazon gallery's brand slate. Drawn on every layout; adFromBrief scores it with the rest of the text.
export const SIGN_OFF = "Hide Nothing.";
function wordmark(x) {
  return `<text x="${x}" y="${TOP + 10}" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="0.6" fill="${C.ink}">Minimalist</text>` +
    `<text x="${x + 1}" y="${TOP + 30}" font-family="${FONT}" font-size="13" letter-spacing="0.4" fill="${C.muted}">${esc(SIGN_OFF)}</text>`;
}

// CTA band, shared by every layout. User review (2026-10-03): "clear CTA is missing" — the button was small and
// often said a vague "Learn more". Now a bigger, bolder button; vague CTAs become an action ("Shop now", or
// "Shop the offer" on offer ads); the product name sits beside it with the shop domain so the next step is obvious.
const VAGUE_CTA = /^(learn more|know more|see more|discover( more)?|find out more|read more|explore|see (the )?ingredients|view ingredients|how it works|learn how|see how|find yours)$/i;
function ctaText(spec) {
  const c = String(spec.cta || "").trim();
  if (c && !VAGUE_CTA.test(c)) return c;
  return spec.layout === "offer" || spec.layout === "pricecompare" ? "Shop the offer" : "Shop now";
}
function ctaBand(spec, x0, bandY) {
  // House look: the statics carry no CTA (Facebook's button does). A user review asked for a visible one, so it is a
  // single line of bold text with an arrow, underlined: clear, but not a button or a band.
  const label = `${ctaText(spec)} →`, fsz = 22;
  return `<text x="${x0}" y="${bandY + 58}" font-family="${FONT}" font-size="${fsz}" font-weight="700" fill="${C.ink}">${esc(label)}</text>` +
    `<line x1="${x0}" y1="${bandY + 66}" x2="${x0 + Math.round(vlen(label) * fsz * 0.56)}" y2="${bandY + 66}" stroke="${C.ink}" stroke-width="1.5"/>`;
}
const aiBadge = (w) => `<rect x="${w - 316}" y="${TOP - 52}" width="296" height="32" rx="4" fill="#B42318"/><text x="${w - 168}" y="${TOP - 31}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="#FFFFFF">AI-GENERATED — ILLUSTRATIVE</text>`;

// CTA band, product name, footnote, test mark -> svg.
function chromeEnd(spec, parts, bottom, cta) {
  const { w } = SIZE, h = FH;
  // bottom = lowest text (unshifted, what measure() checks); cta = top of the "Shop now" line (it follows the content).
  parts.push(ctaBand(spec, PAD, (cta ?? Math.min(bottom + CTA_GAP, ZB - 30)) - 40));
  if (spec.footnote) parts.push(T(wrap(spec.footnote, FOOT_PX, w - 2 * PAD, 0.5).slice(0, 2), PAD, FOOT_Y, FOOT_PX, 30, `fill="${C.muted}"`));
  // Visible AI label whenever generated people/skin/results are in the creative (user decision 2026-10-03).
  if (spec.aiLabel) parts.push(aiBadge(w));
  if (spec.testMark) parts.push(`<text x="${w - 24}" y="${h - 14}" text-anchor="end" font-family="${FONT}" font-size="16" fill="#B42318" fill-opacity="0.85">${esc(spec.testMark)}</text>`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs(spec)}${parts.join("")}</svg>`, bottom };
}

// A real pack shot, aspect kept. On a generated background:
//  - clean transparent cut-out (spec.cutoutHrefs, from the asset library) → no frame; a soft shadow that follows
//    the bottle's silhouette, falling away from the light (spec.shadowDx: + = light from the left), plus a contact
//    shadow ellipse at the base, so it stands IN the scene. Pixels of the product itself are untouched.
//  - studio photo with its own backdrop → deliberate white frame (multiply blend greyed white packs; reverted).
// Contact-shadow base: the photo is "meet"-fitted, so the visible bottom is approximated by the box bottom.
function pack(spec, href, x, y, w, h) {
  if (!href) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${C.rule}" stroke-dasharray="6 6"/>`;
  // A pack cut out in the app (tight crop) stands on the bottom of its box, so the contact shadow is right under it.
  const img = `<image href="${esc(href)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${(spec.groundedHrefs || []).includes(href) ? "xMidYMax" : "xMidYMid"} meet"`;
  // On the white canvas a clean cut-out always gets its soft shadow, like the statics' studio shots.
  if ((spec.cutoutHrefs || []).includes(href)) {
    const dx = spec.shadowDx ?? 12;
    return `<ellipse cx="${x + w / 2 + dx}" cy="${y + h - 4}" rx="${w * 0.32}" ry="${Math.max(8, h * 0.025)}" fill="#000" fill-opacity="0.28" filter="url(#contactBlur)"/>${img} filter="url(#packShadow)"/>`;
  }
  // No frame (minimal look, eye-check 2026-10-04: a white frame boxed the white tubes on the grey canvas). A studio
  // shot without a cut-out sits on a canvas of its own studio grey instead (08_compose.js, spec.canvas).
  return `${img}/>`;
}
// The product zone. With an AI-generated person image (spec.personHref, angle-matrix fill 2026-10-03) the person is
// the main visual — a rounded photo card filling the zone — and the REAL pack shot sits in front as an inset at the
// lower left (the product is never part of the AI image). Without one, the zone holds the pack shot as before.
function productVisual(spec, x, y, w, h) {
  if (!spec.personHref) return pack(spec, spec.imageHref, x, y, w, h);
  // Minimal look (2026-10-04): the person photo (an AI model: Severe risk, AI mark) is a plain rectangle on the right
  // of the zone; the real pack stands in front of its lower-left corner, half on the white canvas, so the product
  // still reads first ("clear product", review 2026-10-03). No card frame, no plinth.
  // A pack without a clean cut-out carries its studio backdrop, which would show as a box over the photo (eye-check
  // 2026-10-04, the white cleanser): then the photo narrows and the pack stands beside it on the canvas instead.
  const isCut = (spec.cutoutHrefs || []).includes(spec.imageHref);
  const cw = Math.round(w * (isCut ? 0.78 : 0.56)), cx = x + w - cw;
  const photo = `<clipPath id="personClip"><rect x="${cx}" y="${y}" width="${cw}" height="${h}" rx="6"/></clipPath>` +
    `<image href="${esc(spec.personHref)}" x="${cx}" y="${y}" width="${cw}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#personClip)"/>`;
  const ih = Math.round(h * 0.62), iw = isCut ? Math.round(w * 0.48) : cx - 6 - (x - 16); // eye-check 2026-10-04: at 42% × 50% the pack read small
  return photo + pack(spec, spec.imageHref, x - 16, y + h - ih, iw, ih);
}
const defs = (spec) => `<defs><filter id="packShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="${spec.shadowDx ?? 12}" dy="14" stdDeviation="12" flood-color="#000" flood-opacity="0.22"/></filter><filter id="contactBlur" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="9"/></filter></defs>`;

function headlineBlock(parts, text, x, y, maxW, s, size = 44) {
  const hs = Math.round(size * s), hl = Math.round(size * 1.18 * s);
  const lines = wrap(text, hs, maxW, 0.56);
  parts.push(T(lines, x, y + hs, hs, hl, `font-weight="500" fill="${C.ink}"`));
  return y + hs + (lines.length - 1) * hl;
}

// Ingredient explainer -> each active as a big % and its name (minimal look 2026-10-04: what each one does moves to the
// caption in leanBrief; a line is drawn only for callers that still pass one).
LAYOUTS.actives = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 490, ZT, 550, PH()));
  const r = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 430, s, 46) + Math.round(44 * s);
    // Each active in the pack-label lockup style (bold name, accent line, light %); an active with no stated % is the
    // bold name alone.
    for (const a of (spec.actives || []).slice(0, 3)) {
      if (a.pct) y = lockup(tp, { name: a.name, pct: a.pct }, spec.accent, PAD, y, s, 430);
      else { const ns = Math.round(28 * s), nl = wrap(a.name, ns, 430, 0.62).slice(0, 2); tp.push(T(nl, PAD, y + ns, ns, Math.round(34 * s), `font-weight="700" fill="${C.ink}"`)); y += ns + (nl.length - 1) * Math.round(34 * s); }
      y += Math.round(12 * s);
      if (a.line) { const ln = wrap(a.line, Math.round(21 * s), 430).slice(0, 2); tp.push(T(ln, PAD, y + Math.round(21 * s), Math.round(21 * s), Math.round(27 * s), `fill="${C.muted}"`)); y += Math.round(21 * s) + (ln.length - 1) * Math.round(27 * s); }
      y += Math.round(30 * s);
    }
    return y - Math.round(30 * s);
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// Routine / product journey -> 2–3 of our packs with numbered steps, as in the brand's "Glow Boosting Routine" static:
// big title, pack, a black numbered circle, the step in capitals, the product name in grey. No arrows.
LAYOUTS.journey = (spec, s) => {
  const { w } = SIZE;
  const parts = chromeStart(spec, "full");
  const steps = (spec.steps || []).slice(0, 3);
  const n = Math.max(1, steps.length), gap = 36, colW = Math.floor((w - 2 * PAD - (n - 1) * gap) / n);
  const r = stack(parts, (tp, y) => {
    const y0 = headlineBlock(tp, spec.headline, PAD, y, w - 2 * PAD, s, 48) + Math.round(44 * s);
    // The packs take the room left under the title (the text under each pack needs ~170px).
    const imgH = Math.max(200, Math.min(Math.round(430 * s), (ZB - 90) - 170 - y0));
    let bottom = y0;
    steps.forEach((st, i) => {
      const x = PAD + i * (colW + gap), cx = Math.round(x + colW / 2);
      tp.push(pack(spec, st.imageHref, x + 12, y0, colW - 24, imgH));
      let ty = y0 + imgH + Math.round(36 * s);
      tp.push(`<circle cx="${cx}" cy="${ty}" r="15" fill="${C.ink}"/><text x="${cx}" y="${ty + 6}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="#FFFFFF">${i + 1}</text>`);
      ty += Math.round(44 * s);
      // "Step 1 · Cleanse" -> "CLEANSE" (the number is in the circle). Labels wrap inside their column.
      const lab = wrap(((st.label || "").replace(/^\s*step\s*\d+\s*[·:.\-–]?\s*/i, "") || `Step ${i + 1}`).toUpperCase(), 17, colW, 0.66).slice(0, 2);
      tp.push(T(lab, cx, ty, 17, 21, `text-anchor="middle" font-weight="700" letter-spacing="1.2" fill="${C.ink}"`));
      ty += (lab.length - 1) * 21 + 26;
      // Under each pack, its active and % in the pack-label style (or the product name when it states none).
      if (st.lockup) ty = lockup(tp, st.lockup, st.accent, cx, ty - 16, 1, colW, "small", "middle") - 4;
      else { const nm = wrap(st.productName || "", 17, colW, 0.56).slice(0, 2); tp.push(T(nm, cx, ty, 17, 21, `text-anchor="middle" fill="${C.muted}"`)); ty += (nm.length - 1) * 21; }
      if (st.line) { const ln = wrap(st.line, 17, colW).slice(0, 2); tp.push(T(ln, cx, ty + 24, 17, 21, `text-anchor="middle" fill="${C.muted}"`)); ty += 24 + (ln.length - 1) * 21; }
      bottom = Math.max(bottom, ty);
    });
    return bottom;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};
// A headline that only repeats its stat (half or more of its words are already in the number's value + label) is not
// drawn: the big number leads (structural rule from the other desk's ad reviews, 2026-10-27: "the big number is the
// strongest stopper in the set, but the headline is repeated above it. Remove the headline above it").
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "&", "with", "for", "as", "is", "by", "at", "what", "does"]);
const statWords = (t) => (String(t || "").toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}%+.-]*/gu) || []).map((w) => w.replace(/[.-]+$/, "")).filter((w) => w && !STOP.has(w));
export function repeatsStat(headline, value, label) {
  const h = statWords(headline), have = new Set(statWords(`${value || ""} ${label || ""}`));
  return h.length > 0 && h.filter((w) => have.has(w)).length / h.length >= 0.5;
}

// Testimonial -> consumer-study stat card (a review is not a claim; a qualified study stat is).
LAYOUTS.stat = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 590, ZT, 450, PH()));
  const r = stack(parts, (tp, y) => {
    const st = spec.stat || {};
    if (!repeatsStat(spec.headline, st.value, st.label)) y = headlineBlock(tp, spec.headline, PAD, y, 490, s, 38) + Math.round(30 * s);
    // Eye-check fix (scale run): long values ("3.9 out of 5 stars") overflowed under the pack; shrink to fit 490px.
    const vs = Math.min(Math.round(150 * s), Math.floor(490 / Math.max(1, vlen(st.value || "") * 0.5)));
    tp.push(`<text x="${PAD - 6}" y="${y + vs}" font-family="${FONT}" font-size="${vs}" font-weight="300" letter-spacing="-4" fill="${C.ink}">${esc(st.value || "")}</text>`);
    y += vs + Math.round(16 * s);
    const ls = wrap(st.label, Math.round(28 * s), 490);
    tp.push(T(ls, PAD, y + Math.round(28 * s), Math.round(28 * s), Math.round(36 * s), `fill="${C.ink}"`));
    y += Math.round(28 * s) + (ls.length - 1) * Math.round(36 * s);
    if (spec.subhead) {
      const sub = wrap(spec.subhead, Math.round(23 * s), 490);
      tp.push(T(sub, PAD, y + Math.round(44 * s), Math.round(23 * s), Math.round(30 * s), `fill="${C.muted}"`));
      y += Math.round(44 * s) + (sub.length - 1) * Math.round(30 * s);
    }
    return y;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// Problem/solution or authority -> labelled callouts pointing at the product (no skin imagery).
LAYOUTS.callouts = (spec, s) => {
  const { w } = SIZE;
  const parts = chromeStart(spec, "full");
  const few = (spec.callouts || []).length <= 2;
  const r = stack(parts, (tp, yt) => {
    const y0 = headlineBlock(tp, spec.headline, PAD, yt, w - 2 * PAD, s, 40) + Math.round(30 * s);
    // With ≤ 2 callouts (the lean house brief) the right-hand slots stayed empty and the right of the frame was blank
    // (user review 2026-10-05): then the pack moves right and grows, and the callouts stack on the left pointing at it.
    const px0 = few ? 540 : 380, pw = few ? 470 : 320, ph = Math.max(300, (ZB - 90) - y0);
    tp.push(pack(spec, spec.imageHref, px0, y0, pw, ph));
    const slots = few ? [[PAD, y0 + ph * 0.22, "L"], [PAD, y0 + ph * 0.58, "L"]] : [[PAD, y0 + ph * 0.2, "L"], [PAD, y0 + ph * 0.6, "L"], [px0 + pw + 30, y0 + ph * 0.2, "R"], [px0 + pw + 30, y0 + ph * 0.6, "R"]];
    let bottom = y0 + ph;
    (spec.callouts || []).slice(0, 4).forEach((c, i) => {
      const [x, y, side] = slots[i];
      const lines = wrap(c.text, Math.round((few ? 26 : 22) * s), few ? 380 : 240);
      tp.push(T(lines, x, y + 22, Math.round((few ? 26 : 22) * s), Math.round((few ? 33 : 28) * s), `font-weight="500" fill="${C.ink}"`));
      const ly = y + 12, lx = few ? x + 390 : x + 252, tx = px0 + (few ? 120 : 40);
      tp.push(side === "L"
        ? `<line x1="${lx}" y1="${ly}" x2="${tx}" y2="${ly + 30}" stroke="${C.ink}" stroke-width="1.5"/><circle cx="${tx}" cy="${ly + 30}" r="4" fill="${C.ink}"/>`
        : `<line x1="${x - 12}" y1="${ly}" x2="${px0 + pw - 40}" y2="${ly + 30}" stroke="${C.ink}" stroke-width="1.5"/><circle cx="${px0 + pw - 40}" cy="${ly + 30}" r="4" fill="${C.ink}"/>`);
      bottom = Math.max(bottom, y + 22 + (lines.length - 1) * 28);
    });
    return bottom;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// Comparison -> spec sheet of OUR tested facts (no rival comparison without like-for-like data).
LAYOUTS.spec = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 590, ZT, 450, PH()));
  const r0 = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 490, s, 40) + Math.round(26 * s);
    for (const r of (spec.specs || []).slice(0, 5)) {
      tp.push(`<line x1="${PAD}" y1="${y}" x2="${PAD + 490}" y2="${y}" stroke="${C.rule}" stroke-width="1.5"/>`);
      tp.push(`<text x="${PAD}" y="${y + Math.round(30 * s)}" font-family="${FONT}" font-size="${Math.round(17 * s)}" font-weight="700" letter-spacing="1.2" fill="${C.muted}">${esc((r.label || "").toUpperCase())}</text>`);
      const v = wrap(r.value, Math.round(24 * s), 490);
      tp.push(T(v, PAD, y + Math.round(62 * s), Math.round(24 * s), Math.round(30 * s), `fill="${C.ink}"`));
      y += Math.round(78 * s) + (v.length - 1) * Math.round(30 * s);
    }
    return y;
  });
  return chromeEnd(spec, parts, r0.fit, r0.cta);
};

// Range guide -> 2–4 of our products, each labelled (skin type / use).
LAYOUTS.range = (spec, s) => {
  const { w } = SIZE;
  const parts = chromeStart(spec, "full");
  const items = (spec.range || []).slice(0, 4);
  const n = Math.max(1, items.length), gap = 24, colW = Math.floor((w - 2 * PAD - (n - 1) * gap) / n);
  const r = stack(parts, (tp, yt) => {
    const y = headlineBlock(tp, spec.headline, PAD, yt, w - 2 * PAD, s, 40) + Math.round(30 * s);
    const imgH = Math.max(240, Math.min(Math.round(470 * s), (ZB - 90) - 120 - y));
    let bottom = y;
    items.forEach((it, i) => {
      const x = PAD + i * (colW + gap);
      // multiply: each photo's near-white studio backdrop melts into the white canvas, so every pack sits on one background.
      tp.push(`<g style="mix-blend-mode:multiply">${pack(spec, it.imageHref, x, y, colW, imgH)}</g>`);
      const lb = wrap(it.label, Math.round(22 * s), colW, 0.56);
      tp.push(T(lb, x, y + imgH + Math.round(38 * s), Math.round(22 * s), Math.round(28 * s), `font-weight="600" fill="${C.ink}"`));
      const ny = y + imgH + Math.round(38 * s) + lb.length * Math.round(28 * s);
      if (it.lockup) bottom = Math.max(bottom, lockup(tp, it.lockup, it.accent, x, ny - Math.round(16 * s), s, colW, "small"));
      else { const nm = wrap(it.productName || "", Math.round(18 * s), colW); tp.push(T(nm, x, ny, Math.round(18 * s), Math.round(23 * s), `fill="${C.muted}"`)); bottom = Math.max(bottom, ny + (nm.length - 1) * Math.round(23 * s)); }
    });
    return bottom;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// Offer -> the offer in plain words as the title, its condition directly underneath in the same block (CCPA 7 /
// ASCI 1.5(a)), as in the brand's statics ("Three products, At the cost of two" + one tiny condition line). Minimal
// look 2026-10-04: no bold price line (prices go to the caption in leanBrief; the statics show none).
LAYOUTS.offer = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 490, ZT, 550, PH()));
  const o = spec.offer || {};
  // Eye-check fix (scale run): sourcing text and URLs belong in the footnote, not the offer block.
  const cleanCond = String(o.condition || "").replace(/Source:[^;]*;?\s*/i, "").replace(/terms:\s*\S+/i, "").replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
  const hs = Math.round(52 * s), hl = Math.round(60 * s), cs = Math.round(21 * s), cl = Math.round(28 * s);
  const head = wrap(o.line || spec.headline, hs, 430, 0.55).slice(0, 4);
  const cond = wrap(cleanCond, cs, 430).slice(0, 3);
  const valid = o.valid_till && !/no end date/i.test(o.valid_till) ? [`Valid till ${o.valid_till}`] : [];
  const sub = spec.subhead ? wrap(spec.subhead, Math.round(23 * s), 430) : [];
  const lkH = spec.lockup ? Math.round(40 * s) + lockupHeight(spec.lockup, s, 430) : 0;
  const height = hs + (head.length - 1) * hl + (cond.length ? Math.round(22 * s) + cond.length * cl : 0) + valid.length * cl + lkH + (sub.length ? Math.round(18 * s) + sub.length * Math.round(31 * s) : 0);
  const r = stack(parts, (tp, y) => {
    tp.push(T(head, PAD, y + hs, hs, hl, `font-weight="500" fill="${C.ink}"`));
    y += hs + (head.length - 1) * hl;
    if (cond.length) { y += Math.round(22 * s); tp.push(T(cond, PAD, y + cs, cs, cl, `fill="${C.muted}"`)); y += cs + (cond.length - 1) * cl; }
    if (valid.length) { tp.push(T(valid, PAD, y + cl, cs, cl, `fill="${C.muted}"`)); y += cl; }
    // Which product the offer is on, in the pack's own style.
    if (spec.lockup) y = lockup(tp, spec.lockup, spec.accent, PAD, y + Math.round(40 * s), s, 430);
    if (sub.length) { y += Math.round(18 * s); tp.push(T(sub, PAD, y + Math.round(23 * s), Math.round(23 * s), Math.round(31 * s), `fill="${C.muted}"`)); y += Math.round(23 * s) + (sub.length - 1) * Math.round(31 * s); }
    return y;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};
// One AI image made of equal panels (2:3 picture, cols x rows): panel idx drawn into the box x,y,w,h.
const sheetPanel = (href, x, y, w, h, cols, rows, idx) => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${100 / cols} ${150 / rows}" preserveAspectRatio="xMidYMid slice"><image href="${esc(href)}" x="${-(idx % cols) * 100 / cols}" y="${-Math.floor(idx / cols) * 150 / rows}" width="100" height="150" preserveAspectRatio="none"/></svg>`;
// Before/after -> two frames that only ever hold REAL, unretouched study photos (never generated).
LAYOUTS.before_after = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 590, ZT, 450, PH()));
  const r = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 480, s, 36) + Math.round(24 * s);
    const fh = Math.max(180, Math.min(Math.round(300 * s), Math.floor(((ZB - 90) - y - 16) / 2)));
    ["BEFORE", "AFTER"].forEach((lab, i) => {
      const photo = (spec.photos || [])[i];
      if (photo && spec.photoSheet) tp.push(sheetPanel(photo, PAD, y, 480, fh, 1, 2, i));
      else if (photo) tp.push(`<image href="${esc(photo)}" x="${PAD}" y="${y}" width="480" height="${fh}" preserveAspectRatio="xMidYMid slice"/>`);
      else {
        tp.push(`<rect x="${PAD}" y="${y}" width="480" height="${fh}" fill="#FFFFFF" stroke="${C.muted}" stroke-dasharray="8 6"/>`);
        tp.push(`<text x="${PAD + 240}" y="${y + fh / 2 + 8}" text-anchor="middle" font-family="${FONT}" font-size="20" font-weight="700" fill="#B42318">REAL STUDY PHOTO REQUIRED</text>`);
      }
      tp.push(`<rect x="${PAD}" y="${y}" width="${lab.length * 14 + 34}" height="42" fill="#FFFFFF"/>`);
      tp.push(`<text x="${PAD + 12}" y="${y + 29}" font-family="${FONT}" font-size="18" font-weight="700" fill="${C.ink}">${lab}</text>`);
      y += fh + 16;
    });
    return y - 16;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// ---------------- 9 layouts added 2026-10-03 (no new photography needed) ----------------

// Eye-check fix (2026-10-03): pills had no width cap, so long badges ran past the panel edge or over the pack.
// Now capped at maxW; long text wraps to 2 lines, then the font shrinks until it fits.
const pill = (x, y, text, s, maxW = 440) => {
  let fs_ = Math.round(22 * s), lines = [text];
  const width = (t) => Math.round(vlen(t) * fs_ * 0.56) + 44;
  if (width(text) > maxW) {
    const words = text.split(/\s+/);
    let best = null;
    for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(" "), b = words.slice(k).join(" "); const m = Math.max(a.length, b.length); if (!best || m < best.m) best = { a, b, m }; }
    if (best) lines = [best.a, best.b];
    while (Math.max(...lines.map(width)) > maxW && fs_ > 14) fs_--;
  }
  const lh = Math.round(fs_ * 1.25), hgt = Math.round(52 * s) + (lines.length - 1) * lh, w = Math.min(maxW, Math.max(...lines.map(width)));
  return `<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${Math.min(Math.round(26 * s), hgt / 2)}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>` +
    lines.map((l, i) => `<text x="${x + 22}" y="${y + Math.round(34 * s) + i * lh}" font-family="${FONT}" font-size="${fs_}" font-weight="500" fill="${C.ink}">${esc(l)}</text>`).join("");
};

// #2 Product + benefit badges: pack centred, 3–4 pills around it.
LAYOUTS.badges = (spec, s) => {
  // Minimal look (2026-10-04): title and the (≤ 2, leanBrief) badges stacked on the left, the pack large on the right.
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 490, ZT, 550, PH()));
  const r = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 430, s, 48) + Math.round(36 * s);
    for (const b of (spec.badges || []).slice(0, 4)) { tp.push(pill(PAD, y, b.text, s, 430)); y += Math.round(52 * s) + Math.round(16 * s) + (vlen(b.text) * 22 * 0.56 + 44 > 430 ? 28 : 0); }
    return y - Math.round(16 * s);
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// #21 Texture shot (user, 2026-10-04: "there are no texture shots"): a REAL photo of the product's texture (asset
// library type "texture", never generated) under the title, the pack large on the right, as in the brand's statics
// that pair a pack with its gel or cream. Without a texture photo the format isn't offered.
LAYOUTS.texture = (spec, s) => {
  const parts = chromeStart(spec, "left");
  // textureScene: one image already holds the pack and its swatch (ChatGPT texture shot, 2026-10-05): draw it large on
  // the right; the tag ("Hide Nothing." / "Skin Science"), title and ingredient lockup stack on the left.
  if (spec.textureScene) {
    parts.push(`<image href="${esc(spec.imageHref)}" x="450" y="${ZT}" width="590" height="${PH()}" preserveAspectRatio="xMidYMid meet"/>`);
    const r = stack(parts, (tp, y) => {
      if (spec.tag) { tp.push(tagLabel(PAD, y, spec.tag)); y += 34 + Math.round(24 * s); }
      y = headlineBlock(tp, spec.headline, PAD, y, 370, s, 44);
      if (spec.lockup) y = lockup(tp, spec.lockup, spec.accent, PAD, y + Math.round(26 * s), s, 370);
      return y;
    });
    return chromeEnd(spec, parts, r.fit, r.cta);
  }
  parts.push(pack(spec, spec.imageHref, 520, ZT, 520, PH()));
  const r = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 430, s, 46);
    if (spec.lockup) y = lockup(tp, spec.lockup, spec.accent, PAD, y + Math.round(26 * s), s, 430);
    const ty = y + Math.round(36 * s), th = 260;
    // Without a photo yet (app draft) the slot is drawn empty and labelled, like the before/after frames.
    if (!spec.textureHref) tp.push(`<rect x="${PAD}" y="${ty}" width="420" height="${th}" rx="8" fill="#FFFFFF" stroke="${C.muted}" stroke-dasharray="8 6"/><text x="${PAD + 210}" y="${ty + th / 2 + 7}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="#B42318">REAL TEXTURE PHOTO REQUIRED</text>`);
    if (spec.textureHref) tp.push(`<clipPath id="texClip"><rect x="${PAD}" y="${ty}" width="420" height="${th}" rx="8"/></clipPath><image href="${esc(spec.textureHref)}" x="${PAD}" y="${ty}" width="420" height="${th}" preserveAspectRatio="xMidYMid slice" clip-path="url(#texClip)"/>`);
    return ty + th;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

function twoColumns(spec, s, left, right, rightHasPack) {
  const { w } = SIZE;
  const parts = chromeStart(spec, "full");
  const colW = (w - 2 * PAD - 40) / 2;
  const itemsOf = (col) => (col?.items || []).slice(0, 4).map((it0) => wrap(typeof it0 === "string" ? it0 : it0?.text || "", Math.round(22 * s), colW - 60));
  // Items may be plain strings or {text, cites} (the brief shape briefLines reads); eye-check 2026-10-05 drew
  // "[object Object]" for the second.
  const itemsH = (col) => itemsOf(col).reduce((a, ln) => a + ln.length * Math.round(28 * s) + Math.round(14 * s), 0);
  const r = stack(parts, (tp, yt) => {
    const y0 = headlineBlock(tp, spec.headline, PAD, yt, w - 2 * PAD, s, 40) + Math.round(30 * s);
    // Both cards share one height: the longer list plus a pack large enough to read (>= 260px), capped by the room left.
    const need = 70 + Math.max(itemsH(left), itemsH(right)) + 30 + 400;
    const cardH = Math.max(Math.min(need, (ZB - 90) - y0), 420);
    [[left, PAD, false], [right, PAD + colW + 40, rightHasPack]].forEach(([col, x, hasPack]) => {
      tp.push(`<rect x="${x}" y="${y0}" width="${colW}" height="${cardH}" rx="10" fill="${hasPack ? "#FFFFFF" : C.bg}" stroke="${C.rule}" stroke-width="1.5"/>`);
      tp.push(`<text x="${x + 24}" y="${y0 + 44}" font-family="${FONT}" font-size="${Math.round(24 * s)}" font-weight="700" fill="${hasPack ? C.ink : C.muted}">${esc((col?.title || "").toUpperCase())}</text>`);
      let y = y0 + 70;
      for (const ln of itemsOf(col)) {
        tp.push(`<text x="${x + 24}" y="${y + 22}" font-family="${FONT}" font-size="22" fill="${hasPack ? C.ink : C.muted}">${hasPack ? "✓" : "–"}</text>`);
        tp.push(T(ln, x + 52, y + 22, Math.round(22 * s), Math.round(28 * s), `fill="${hasPack ? C.ink : C.muted}"`));
        y += ln.length * Math.round(28 * s) + Math.round(14 * s);
      }
      // The pack fills the rest of its card, centred.
      if (hasPack) { const ph = y0 + cardH - 16 - (y + 10); if (ph >= 160) tp.push(pack(spec, spec.imageHref, x + 20, y + 10, colW - 40, ph)); }
    });
    return y0 + cardH;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
}

// #18 Old way / new way (the old way is a routine or habit, never another brand).
LAYOUTS.oldnew = (spec, s) => twoColumns(spec, s, spec.old, spec.new, true);
// #19 This vs that (two approaches, e.g. scrub vs acid exfoliant).
LAYOUTS.thisvsthat = (spec, s) => twoColumns(spec, s, (spec.columns || [])[0], (spec.columns || [])[1], true);

// #17 Us vs Them (user review 2026-10-04: "us vs them is missing"). Minimalist's own Amazon gallery runs a comparison
// table "vs Other Vitamin C Serums". Rules (prompts/pipeline_brief_writer.md): "them" is an unnamed benchmark,
// ingredient or product type that the brand's own page names — never a named or recognisable brand, never a rival's
// pack; each row cites the page fact behind both sides; the basis of the comparison is the footnote (ASCI Chapter IV).
// House look: white canvas, the real pack as the hero on the left, ≤ 3 short rows on the right.
LAYOUTS.usvsthem = (spec, s) => {
  const { w } = SIZE, h = FH;
  const parts = [`<rect width="${w}" height="${h}" fill="${spec.canvas || "#FFFFFF"}"/>`, wordmark(PAD, spec)];
  const c = spec.compare || {};
  const r0 = stack(parts, (tp, yt) => {
    let y0 = headlineBlock(tp, spec.headline, PAD, yt, w - 2 * PAD, s, 46);
    if (spec.subhead) {
      const sl = wrap(spec.subhead, Math.round(24 * s), w - 2 * PAD);
      tp.push(T(sl, PAD, y0 + Math.round(40 * s), Math.round(24 * s), Math.round(32 * s), `fill="${C.muted}"`));
      y0 += Math.round(40 * s) + (sl.length - 1) * Math.round(32 * s);
    }
    y0 += Math.round(50 * s);
    // The comparison table is drawn first (origin 0) to learn its height; the pack then matches it and the table is
    // centred against the pack, so neither side hangs.
    const tx = 500, colW = Math.floor((w - PAD - tx) / 2), tt = [];
    const hs = Math.round(20 * s), hl = Math.round(25 * s);
    // Up to 3 header lines (eye-check 2026-10-04: at 2, "Ethyl Ascorbic Acid (the form used)" lost its last word).
    const hu = wrap(c.us || "", hs, colW - 20, 0.6).slice(0, 3), ht = wrap(c.them || "", hs, colW - 20, 0.6).slice(0, 3);
    tt.push(T(hu, tx, hs, hs, hl, `font-weight="700" fill="${C.ink}"`), T(ht, tx + colW, hs, hs, hl, `font-weight="500" fill="${C.muted}"`));
    let y = hs + (Math.max(hu.length, ht.length) - 1) * hl + Math.round(16 * s);
    tt.push(`<line x1="${tx}" y1="${y}" x2="${tx + colW - 20}" y2="${y}" stroke="${C.ink}" stroke-width="3"/><line x1="${tx + colW}" y1="${y}" x2="${w - PAD}" y2="${y}" stroke="${C.rule}" stroke-width="3"/>`);
    for (const r of (c.rows || []).slice(0, 3)) {
      const ls = Math.round(16 * s), lab = wrap((r.label || "").toUpperCase(), ls, w - PAD - tx, 0.68).slice(0, 2);
      tt.push(T(lab, tx, y + Math.round(36 * s), ls, Math.round(20 * s), `font-weight="700" letter-spacing="1.2" fill="${C.muted}"`));
      y += Math.round(36 * s) + (lab.length - 1) * Math.round(20 * s) + Math.round(12 * s);
      const val = (t, x, ink, wt) => {
        const sz = Math.round((vlen(t) > 9 ? 28 : 44) * s), ln = wrap(t || "", sz, colW - 24, 0.56).slice(0, 2);
        tt.push(T(ln, x, y + sz, sz, Math.round(sz * 1.15), `font-weight="${wt}" fill="${ink}"`));
        return sz + (ln.length - 1) * Math.round(sz * 1.15);
      };
      y += Math.max(val(r.us, tx, C.ink, 600), val(r.them, tx + colW, C.muted, 300)) + Math.round(22 * s);
      tt.push(`<line x1="${tx}" y1="${y}" x2="${w - PAD}" y2="${y}" stroke="${C.rule}" stroke-width="1.5"/>`);
    }
    const ph = Math.max(Math.min((ZB - 90) - y0, 560), 380), off = Math.max(0, Math.round((ph - y) / 2));
    // On white the cut-out gets its shadow too (pack() draws it only over a background).
    tp.push(pack({ ...spec, backgroundHref: spec.backgroundHref || "white" }, spec.imageHref, PAD - 10, y0, 380, ph));
    tp.push(`<g transform="translate(0 ${y0 + off})">${tt.join("")}</g>`);
    return y0 + ph;
  });
  return chromeEnd(spec, parts, r0.fit, r0.cta);
};

// #26 Review card: one genuine review (source + date required), small pack shot.
LAYOUTS.review = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 540, ZT, 500, PH()));
  const r = spec.review || {};
  const qs = Math.round(32 * s), ql = Math.round(42 * s), qAll = wrap(`“${r.quote || ""}”`, qs, 440, 0.52), q = qAll.slice(0, 6);
  // A quote that needs more than 6 lines at this size forces a smaller size; at the smallest, layoutProblems blocks it.
  if (qAll.length > 6) return { svg: chromeEnd(spec, parts, 0).svg, bottom: 1e9 };
  // Stars only when the review states its rating (4, or "★★★★"). A quote with no rating gets none: drawing five
  // would invent one. (Fix 2026-10-04: a "★★★★" string drew nothing, and a missing rating drew five.)
  const stars = Math.min(5, typeof r.stars === "string" ? (r.stars.match(/★/g) || []).length || Number(r.stars) || 0 : Number(r.stars) || 0);
  // Minimal look (2026-10-04): no card box; stars, the quote set large, the source in grey.
  const r0 = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 440, s, 30) + Math.round(40 * s);
    if (stars) { tp.push(`<text x="${PAD}" y="${y + 30}" font-family="${FONT}" font-size="30" letter-spacing="2" fill="${C.ink}">${"★".repeat(stars)}</text>`); y += 30 + Math.round(30 * s); }
    tp.push(T(q, PAD, y + qs, qs, ql, `font-weight="400" fill="${C.ink}"`));
    y += qs + (q.length - 1) * ql;
    // No source on record: the line is skipped, never a placeholder.
    if (r.source) { y += Math.round(30 * s); const src = wrap(r.source, 18, 440).slice(0, 2); tp.push(T(src, PAD, y + 18, 18, 23, `fill="${C.muted}"`)); y += 18 + (src.length - 1) * 23; }
    if (spec.lockup) y = lockup(tp, spec.lockup, spec.accent, PAD, y + Math.round(40 * s), s, 440);
    return y;
  });
  return chromeEnd(spec, parts, r0.fit, r0.cta);
};

// #28 Social proof: one big sourced number.
LAYOUTS.socialproof = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(productVisual(spec, 590, ZT, 450, PH()));
  const p = spec.proof || {};
  const r = stack(parts, (tp, y) => {
    if (!repeatsStat(spec.headline, p.value, p.label)) y = headlineBlock(tp, spec.headline, PAD, y, 490, s, 34) + Math.round(24 * s);
    const vs = Math.min(Math.round(130 * s), Math.floor(490 / Math.max(1, vlen(p.value || "") * 0.5)));
    tp.push(`<text x="${PAD - 4}" y="${y + vs}" font-family="${FONT}" font-size="${vs}" font-weight="300" letter-spacing="-3" fill="${C.ink}">${esc(p.value || "")}</text>`);
    y += vs + Math.round(20 * s);
    const l = wrap(p.label, Math.round(28 * s), 490);
    tp.push(T(l, PAD, y + 28, Math.round(28 * s), Math.round(36 * s), `fill="${C.ink}"`));
    y += 28 + (l.length - 1) * 36;
    if (p.source) { tp.push(T([p.source], PAD, y + 44, 18, 22, `fill="${C.muted}"`)); y += 44; }
    if (spec.lockup) y = lockup(tp, spec.lockup, spec.accent, PAD, y + Math.round(36 * s), s, 490);
    return y;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

function qa(spec, s, q, a, bubble) {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 540, ZT, 500, PH()));
  const ql = wrap(q, Math.round(bubble ? 30 : 46 * s), bubble ? 390 : 440, 0.58);
  const r = stack(parts, (tp, y) => {
    if (bubble) {
      const h = ql.length * 40 + 40;
      tp.push(`<rect x="${PAD}" y="${y}" width="450" height="${h}" rx="22" fill="#FFFFFF" stroke="${C.rule}"/>`);
      tp.push(T(ql, PAD + 28, y + 50, 30, 40, `font-weight="600" fill="${C.ink}"`));
      y += h + 30;
    } else {
      const hs = Math.round(46 * s);
      tp.push(T(ql, PAD, y + hs, hs, Math.round(54 * s), `font-weight="700" fill="${C.ink}"`));
      y += hs + (ql.length - 1) * Math.round(54 * s) + 40;
    }
    const al = wrap(a, Math.round(25 * s), 440);
    tp.push(T(al, PAD, y + 25, Math.round(25 * s), Math.round(33 * s), `fill="${C.ink}"`));
    return y + 25 + (al.length - 1) * Math.round(33 * s);
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
}
// #32 Comment / FAQ: question bubble answered from the product page's own FAQ.
LAYOUTS.faq = (spec, s) => qa(spec, s, spec.faq?.question || "", spec.faq?.answer || "", true);
// #35 Question-led: big neutral question (never "do YOU have…").
LAYOUTS.question = (spec, s) => qa(spec, s, spec.question || spec.headline || "", spec.answer || spec.subhead || "", false);

// #33 Native social: big casual headline, small pack, plain feel (still labelled as an ad by the platform).
LAYOUTS.native = (spec, s) => {
  const { w } = SIZE;
  const parts = chromeStart(spec, "full");
  const hs = Math.round(54 * s);
  // With an AI creator/UGC image: headline across the top, then a large photo card on the right and the pack BESIDE it
  // on the left (eye-check 2026-10-03: as an inset on this smaller card the pack covered the person's face).
  if (spec.personHref) {
    const hl = wrap(spec.headline, hs, w - 2 * PAD, 0.55);
    const r = stack(parts, (tp, y) => {
      tp.push(T(hl.slice(0, 4), PAD, y + hs, hs, Math.round(64 * s), `font-weight="600" fill="${C.ink}"`));
      y += hs + (Math.min(4, hl.length) - 1) * Math.round(68 * s) + 30;
      if (spec.subhead) {
        const sl = wrap(spec.subhead, Math.round(26 * s), 560);
        tp.push(T(sl, PAD, y + 26, Math.round(26 * s), Math.round(34 * s), `fill="${C.muted}"`));
        y += sl.length * Math.round(34 * s);
      }
      const cy = y + 24, bot = ZB - 90, ch = Math.max(300, bot - cy);
      tp.push(`<clipPath id="personClip"><rect x="520" y="${cy}" width="488" height="${ch}" rx="6"/></clipPath><image href="${esc(spec.personHref)}" x="520" y="${cy}" width="488" height="${ch}" preserveAspectRatio="xMidYMid slice" clip-path="url(#personClip)"/>`);
      const ph = Math.min(ch, 440);
      tp.push(pack(spec, spec.imageHref, PAD, cy + ch - ph, 420, ph));
      return cy + ch;
    });
    return chromeEnd(spec, parts, r.fit, r.cta);
  }
  // No person: the headline set big beside a large pack (eye-check 2026-10-05: a small corner pack was lost on white).
  parts.push(pack(spec, spec.imageHref, 500, ZT, 540, PH()));
  const hl = wrap(spec.headline, hs, 420, 0.55);
  const r = stack(parts, (tp, y) => {
    tp.push(T(hl.slice(0, 5), PAD, y + hs, hs, Math.round(64 * s), `font-weight="600" fill="${C.ink}"`));
    y += hs + (Math.min(5, hl.length) - 1) * Math.round(64 * s);
    if (spec.subhead) {
      const sl = wrap(spec.subhead, Math.round(26 * s), 420);
      tp.push(T(sl, PAD, y + 30 + 26, Math.round(26 * s), Math.round(34 * s), `fill="${C.muted}"`));
      y += 30 + 26 + (sl.length - 1) * Math.round(34 * s);
    }
    return y;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// #37 Price comparison: every price with its source and date (marketer-supplied, shown as [placeholders] if absent).
LAYOUTS.pricecompare = (spec, s) => {
  const parts = chromeStart(spec, "left");
  parts.push(pack(spec, spec.imageHref, 590, ZT, 450, PH()));
  const r = stack(parts, (tp, y) => {
    y = headlineBlock(tp, spec.headline, PAD, y, 490, s, 38) + Math.round(30 * s);
    for (const p of (spec.prices || []).slice(0, 3)) {
      tp.push(`<line x1="${PAD}" y1="${y}" x2="${PAD + 490}" y2="${y}" stroke="${C.rule}" stroke-width="1.5"/>`);
      tp.push(`<text x="${PAD}" y="${y + 40}" font-family="${FONT}" font-size="${Math.round(24 * s)}" fill="${C.ink}">${esc(p.label)}</text>`);
      tp.push(`<text x="${PAD + 490}" y="${y + 40}" text-anchor="end" font-family="${FONT}" font-size="${Math.round(30 * s)}" font-weight="700" fill="${C.ink}">${esc(p.value)}</text>`);
      tp.push(T([p.note || ""], PAD, y + 66, 17, 20, `fill="${C.muted}"`));
      y += Math.round(86 * s);
    }
    return y - Math.round(14 * s);
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// #14 Progress / timeline: 3–4 frames (real study photos, or AI-generated with the mark + Severe risk).
LAYOUTS.timeline = (spec, s) => {
  const { w } = SIZE;
  const parts = chromeStart(spec, "full");
  const frames = (spec.frames || []).slice(0, 4);
  const r = stack(parts, (tp0, yt) => {
  const parts = tp0;
  const y0 = headlineBlock(parts, spec.headline, PAD, yt, w - 2 * PAD, s, 40) + Math.round(36 * s);
  // The real pack gets its own column at the right, level with the frames (clear product; the AI mark owns the top right).
  // Remake 2026-10-05 (spec.packInFrames): the real pack is composited small into the lower-right of EVERY frame (the AI image leaves that corner empty), so frames take the full width.
  const packW = spec.packInFrames ? 0 : 190, n = Math.max(1, frames.length), gap = 16, fw = Math.floor((w - 2 * PAD - (packW ? packW + 24 : 0) - (n - 1) * gap) / n), fh = Math.min(Math.round(fw * 1.3), (ZB - 90) - 50 - y0);
  frames.forEach((f, i) => {
    const x = PAD + i * (fw + gap);
    if (f.imageHref && spec.frameSheet) parts.push(sheetPanel(f.imageHref, x, y0, fw, fh, 2, 2, i));
    else if (f.imageHref) parts.push(`<clipPath id="fr${i}"><rect x="${x}" y="${y0}" width="${fw}" height="${fh}" rx="6"/></clipPath><image href="${esc(f.imageHref)}" x="${x}" y="${y0}" width="${fw}" height="${fh}" preserveAspectRatio="xMidYMid slice" clip-path="url(#fr${i})"/>`);
    else parts.push(`<rect x="${x}" y="${y0}" width="${fw}" height="${fh}" fill="#FFFFFF" stroke="${C.muted}" stroke-dasharray="8 6"/><text x="${x + fw / 2}" y="${y0 + fh / 2}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="#B42318">PHOTO REQUIRED</text>`);
    // Minimal look (2026-10-04): the label sits under the frame in small capitals, not on a dark bar over it.
    parts.push(T(wrap(String(f.label || "").toUpperCase(), 16, fw, 0.66).slice(0, 2), x, y0 + fh + 30, 16, 20, `font-weight="700" letter-spacing="1.2" fill="${C.ink}"`));
  });
  if (spec.packInFrames) frames.forEach((f, i) => { const x = PAD + i * (fw + gap), pw = Math.round(fw * 0.3), ph = Math.round(fh * 0.4); parts.push(pack(spec, spec.imageHref, x + fw - pw - 8, y0 + fh - ph - 8, pw, ph)); });
  else { const ph = Math.min(fh, 320); parts.push(pack(spec, spec.imageHref, w - PAD - packW, y0 + fh - ph, packW, ph)); }
  return y0 + fh + 50;
  });
  return chromeEnd(spec, parts, r.fit, r.cta);
};

// #13 Split-screen: one image, divided, labelled sides (same rules as timeline).
LAYOUTS.splitscreen = (spec, s) => LAYOUTS.timeline({ ...spec, frames: (spec.frames || []).slice(0, 2) }, s);

// Overflow check used by the generator: returns problems instead of silently clipping text.
export function layoutProblems(spec, H = 1080) {
  const problems = [];
  const m = measure(spec, H);
  if (!m.fits) problems.push(`Copy does not fit the 1080x${H} layout even at 70% text size — shorten it.`);
  // Bug fix (2026-10-04): the creative draws 2 footnote lines, but this only warned past 3, so a 3-line qualifier lost
  // its last line silently (two ads did). A qualifier that doesn't fit must be shortened, never cut.
  if (spec.footnote && wrap(spec.footnote, FOOT_PX, SIZE.w - 144, 0.5).length > 2) problems.push("Footnote longer than 2 lines would be cut off.");
  const lim = (label, text, max) => {
    if (text && text.length > max) problems.push(`${label} is ${text.length} chars (max ${max})`);
  };
  lim("Headline", spec.headline, 60);
  lim("Subhead", spec.subhead, 120);
  (spec.proofPoints || []).forEach((p, i) => lim(`Proof point ${i + 1}`, p, 70));
  lim("Footnote", spec.footnote, 200);
  if ((spec.proofPoints || []).length > 3) problems.push("More than 3 proof points");
  (spec.actives || []).forEach((a, i) => lim(`Active ${i + 1} line`, a.line, 90));
  (spec.steps || []).forEach((st, i) => lim(`Step ${i + 1} line`, st.line, 70));
  (spec.callouts || []).forEach((c, i) => lim(`Callout ${i + 1}`, c.text, 60));
  (spec.specs || []).forEach((r, i) => lim(`Spec ${i + 1}`, r.value, 70));
  (spec.range || []).forEach((r, i) => lim(`Range label ${i + 1}`, r.label, 40));
  (spec.compare?.rows || []).forEach((r, i) => { lim(`Row ${i + 1} label`, r.label, 40); lim(`Row ${i + 1} us`, r.us, 24); lim(`Row ${i + 1} them`, r.them, 24); });
  // The review card draws 6 quote lines at most: a longer quote must be swapped for a shorter one, never cut.
  if (spec.layout === "review" && spec.review?.quote && wrap(`“${spec.review.quote}”`, Math.round(32 * m.scale), 440, 0.52).length > 6) problems.push("Customer quote is too long for the card and would be cut; use a shorter quote (never shorten one).");
  if (spec.layout === "offer" && spec.offer && !String(spec.offer.condition || "").trim()) problems.push("Offer has no condition: 'free' / discount terms must sit with the offer (CCPA 7).");
  if (spec.layout === "before_after" && !(spec.photos || []).length && !(spec.photoSrcs || []).length) problems.push("Before/after has no real study photos attached — export stays blocked.");
  if (["journey", "range"].includes(spec.layout) && (spec.steps || spec.range || []).some((x) => !x.imageHref && !x.imageSrc)) problems.push("A product in the journey/range has no pack shot.");
  return problems;
}

// Sizes every ad is drawn in natively (renderAdSvg(spec, h)).
export const PLACEMENTS = [
  { key: "1x1", label: "1:1", w: 1080, h: 1080 },
  { key: "4x5", label: "4:5", w: 1080, h: 1350 },
  { key: "9x16", label: "9:16", w: 1080, h: 1920 },
];
