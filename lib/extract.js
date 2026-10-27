// Pulls a product "fact sheet" from a beminimalist.co product page.
//
// Design rule: only BRAND-AUTHORED sections become facts. Customer reviews (Yotpo widget),
// the AI review summary, promo banners and cross-sell tiles are deliberately dropped —
// a review saying "my skin colour is lighten" must never become ad copy.
// Every fact gets an id (F1, F2...) so generated copy can cite where each line came from.

const ALLOWED_HOSTS = new Set(["beminimalist.co", "www.beminimalist.co"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

// Section titles seen on product pages, mapped to what kind of fact they hold.
// Anything not listed is kept as "other" so nothing brand-authored is silently lost.
const SECTION_KINDS = [
  [/what makes it potent/i, "claim"],
  [/benefit/i, "claim"],
  [/consumer stud|clinical/i, "study"],
  [/ideal for/i, "suitability"],
  [/how to use|directions/i, "usage"],
  [/all ingredients/i, "inci"],
  [/specification|shelf life|manufactur|dimension|country/i, "admin"],
];

export function parseProductUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error("This tool is set up for Minimalist (beminimalist.co) products. Paste a beminimalist.co product link.");
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) throw new Error("URL must be a product page (…/products/<name>).");
  return { origin: "https://beminimalist.co", handle: decodeURIComponent(m[1]) };
}

export function decodeEntities(s) {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToLines(fragment) {
  return decodeEntities(
    fragment
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sectionKind(title) {
  for (const [re, kind] of SECTION_KINDS) if (re.test(title)) return kind;
  if (/\?\s*$/.test(title)) return "faq";
  return "other";
}

// Customer testimonials are embedded in the brand's own description area on some pages
// (found on Niacinamide 10% and Salicylic+LHA cleanser during the first extraction test),
// so "not inside the review widget" is NOT enough to call a line brand-authored.
// A testimonial is never usable as an ad claim: it's one person's experience, not substantiation.
export function looksLikeTestimonial(line) {
  const t = line.trim();
  // Signature needs whitespace before the dash: "...cleanser\" -Nikhil V." yes, "Acne-Prone" no
  // (that false positive was caught on the cleanser's "Ideal For" line).
  return /^["“]/.test(t) || /["”]?\s+[-–—]\s*[A-Z][a-z]+(\s[A-Z]\.?)?\.?["”]?\s*$/.test(t);
}

// "When to use: When to use: AM & PM" -> "When to use: AM & PM"
function dedupeLabel(line) {
  return line.replace(/^([A-Za-z /]+:)\s*\1\s*/i, "$1 ");
}

// "Niacinamide 10% Face Serum" -> [{name:"Niacinamide", pct:"10%"}]
// "Salicylic + LHA 02% Cleanser" -> [{name:"Salicylic + LHA", pct:"02%"}]
// Keeps the concentration exactly as printed (leading zero included) — that IS the brand style.
export function activesFromTitle(title) {
  const out = [];
  const re = /([A-Z][A-Za-z0-9\-\.&'+ ]*?)\s+(\d+(?:\.\d+)?)\s*%/g;
  let m;
  while ((m = re.exec(title))) out.push({ name: m[1].trim(), pct: m[2] + "%" });
  // Sunscreens lead with SPF rather than a % active — that number is the pack's headline fact.
  const spf = title.match(/SPF\s*(\d+)/i);
  if (spf) out.push({ name: "SPF", pct: spf[1] });
  return out;
}

// Product lines whose ads are made but rated Severe (user, 2026-10-05: "it should make images and show severe"):
// Pediatrics: claims made to parents about infant skin are the highest-stakes claims in the catalog, so every ad is
// Severe and can't be exported until a human writer and legal have signed it off.
export function refusalReason(sheet) {
  if (/pediatric/i.test(sheet.url) || sheet.facts.some((f) => /Minimalist Pediatrics/i.test(f.text))) {
    return "Pediatrics (baby care) range: every ad is rated Severe. Copy for infant products needs a human writer and legal sign-off before any use.";
  }
  return null;
}

export function parseProductHtml(html) {
  const h1 = html.match(/<h1[^>]*product__title[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1 ? htmlToLines(h1[1]).join(" ") : "";

  const subtitles = [...html.matchAll(/<span[^>]*product__subtitle[^>]*>([\s\S]*?)<\/span>\s*(?=<span|<div|<\/div)/gi)]
    .flatMap((m) => htmlToLines(m[1]));

  const sections = [];
  for (const m of html.matchAll(/<toggle-tab[\s\S]*?<\/toggle-tab>/gi)) {
    const block = m[0];
    if (/yotpo/i.test(block)) continue; // reviews never become facts
    const t = block.match(/class="toggle__(?:title|heading)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
    const c = block.match(/class="toggle__content[^"]*"[^>]*>([\s\S]*)<\/div>\s*<\/toggle-tab>/i);
    if (!t || !c) continue;
    const secTitle = htmlToLines(t[1]).join(" ");
    const lines = htmlToLines(c[1]).filter((l) => l.length > 2);
    if (secTitle && lines.length) sections.push({ title: secTitle, kind: sectionKind(secTitle), lines });
  }
  return { title, subtitles, sections };
}

// Promo / loyalty / cart / delivery lines are never product facts (the page-wide filter; see also lib/extract_generic.js).
export const STRICT_PROMO = /(\w*coins?\b|\bcashback\b|\bcoupons?\b|\bpromo code\b|\d+\s?%\s?off\b|\bfree (shipping|delivery)\b|\bemi\b|add to (cart|bag)|\bpincode\b|\bdelivery (by|in|date)\b|\bwrite a review\b)/i;
export function buildFactSheet({ title, subtitles, sections, images = [], price = null, url = "" }) {
  const facts = [];
  const add = (section, kind, text) => facts.push({ id: `F${facts.length + 1}`, section, kind, text });
  const kindFor = (k, line) => (looksLikeTestimonial(line) ? "testimonial" : k);
  const promo = (l) => STRICT_PROMO.test(l);
  if (title) add("Product name", "name", title);
  subtitles
    .filter((s) => s.trim() !== title.trim() && !promo(s))
    .forEach((s) => add("Tagline / description", kindFor("claim", s), s));
  for (const s of sections) {
    if (s.kind === "admin") continue;
    for (const raw of s.lines) {
      const line = dedupeLabel(raw);
      if (promo(line)) continue;
      add(s.title, kindFor(s.kind === "other" ? "ingredient_note" : s.kind, line), line);
    }
  }
  return {
    url,
    title,
    actives: activesFromTitle(title),
    price,
    images,
    facts,
    source: "page",
  };
}

async function get(url, as = "text") {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: as === "json" ? "application/json" : "text/html" } });
  if (!r.ok) throw new Error(`Fetch ${url} -> HTTP ${r.status}`);
  return as === "json" ? r.json() : r.text();
}

export async function extractFromUrl(rawUrl) {
  const { origin, handle } = parseProductUrl(rawUrl);
  const pageUrl = `${origin}/products/${encodeURIComponent(handle)}`;
  const [html, js] = await Promise.all([get(pageUrl), get(`${pageUrl}.js`, "json").catch(() => null)]);
  const parsed = parseProductHtml(html);
  if (!parsed.title && js) parsed.title = js.title;
  const images = js ? (js.images || []).map((src) => (src.startsWith("//") ? "https:" + src : src)) : [];
  const price = js && js.price ? js.price / 100 : null;
  const sheet = buildFactSheet({ ...parsed, images, price, url: pageUrl });
  if (!sheet.title || sheet.facts.length < 3) {
    throw new Error("Page fetched but product facts could not be read (layout may have changed). Use manual entry.");
  }
  return sheet;
}

// Manual / pasted fallback: the marketer supplies the same fields by hand.
// Facts entered this way are marked source:"manual" and the scorer treats them as unverified.
export function factSheetFromManual({ title = "", tagline = "", claims = "", imageUrl = "", url = "" }) {
  const sheet = buildFactSheet({
    title: title.trim(),
    subtitles: tagline ? [tagline.trim()] : [],
    sections: claims.trim()
      ? [{ title: "Pasted claims", kind: "claim", lines: claims.split(/\n+/).map((s) => s.trim()).filter(Boolean) }]
      : [],
    images: imageUrl ? [imageUrl.trim()] : [],
    url,
  });
  sheet.source = "manual";
  return sheet;
}
