// Any product page, read LIVE (user, 2026-10-05: "it should work for any product I give"). One fetch of the page (plus the
// product's own .js JSON on Shopify stores), then, in this order:
//   (a) Shopify store: /products/<handle>.js JSON + the page HTML (any Shopify brand);
//   (b) schema.org Product in JSON-LD (name, description, image, brand, offers, aggregateRating, review);
//   (c) OpenGraph / meta tags + the main visible text (headings, bullet lists, paragraphs).
// Same fact sheet shape as lib/extract.js (ids F1..., kinds claim / suitability / usage / study / testimonial; PRICE1, RATING,
// REV1.. for the live kinds). beminimalist.co keeps its own parser (extractFromUrl), the best path for that site.
// Never invents: fewer than 3 facts is an error that sends the user to manual entry, with the reason.
import { activesFromTitle, decodeEntities, looksLikeTestimonial, extractFromUrl } from "./extract.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 AdPrescreenBot/1.0 (+one read per page)";
const BLOCKING_SITES = /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z.]+|flipkart\.com|myntra\.com|ajio\.com|meesho\.com|walmart\.com|target\.com|ebay\.[a-z.]+)$/i;
export const BLOCKED_MSG = "This site blocks automated reading. Paste the product details with \"Enter manually\", or use the brand's own site (most brands sell on their own website).";
export const MIN_FACTS = 3;
export const NOT_MINIMALIST = "This tool is set up for Minimalist (beminimalist.co) products. Paste a beminimalist.co product link.";
// Promo / loyalty / cart / delivery / review-widget lines are never product claims; they are kept only as offers shown on the brand's own page.
export const PROMO = /\b(\w*coins?|points?|cashback|cash back|coupons?|promo|code|offers?|deals?|discount|\d+\s?%\s?off|off on|free (shipping|delivery|gift)|buy \d|get \d|bogo|emi|no[- ]cost|add to (cart|bag)|in your cart|delivery|pincode|pin code|reviews?|rated|rating|write a review|earn|reward|wallet|members?|sale|save (rs|₹|\d))\b/i;

export const isMinimalistHost = (host) => /(^|\.)beminimalist\.co$/i.test(host || "");
export const brandSiteOf = (url) => { try { return isMinimalistHost(new URL(url).hostname) ? "minimalist" : "other"; } catch { return "minimalist"; } };

// Only public http(s) pages: no localhost, private ranges or odd schemes.
export function checkPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error("That doesn't look like a URL."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) product pages can be read.");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "[::1]" || /^\[/.test(h) || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || !h.includes(".")) throw new Error("Only public product pages can be read.");
  return u;
}

const clean = (s) => decodeEntities(String(s || "")).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, " ").trim();
const abs = (src, base) => { try { return new URL(String(src).startsWith("//") ? "https:" + src : src, base).href; } catch { return ""; } };
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function linesOf(fragment) {
  return decodeEntities(String(fragment || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((s) => clean(s)).filter(Boolean);
}

// ---------- (b) JSON-LD ----------
export function parseJsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { out.push(x); if (x["@graph"]) walk(x["@graph"]); } };
    walk(j);
  }
  const p = out.find((x) => [].concat(x["@type"] || []).some((t) => /^Product$/i.test(t)));
  if (!p) return null;
  const first = (v) => (Array.isArray(v) ? first(v[0]) : v);
  const img = (v) => [].concat(v || []).map((i) => (typeof i === "string" ? i : i?.url || "")).filter(Boolean);
  const offer = first(p.offers) || {};
  const rating = p.aggregateRating || null;
  return {
    name: clean(p.name), description: clean(String(p.description || "").replace(/<[^>]+>/g, " ")), images: img(p.image),
    brand: clean(typeof p.brand === "string" ? p.brand : p.brand?.name),
    price: Number(offer.price ?? offer.lowPrice) || null, currency: offer.priceCurrency || "",
    rating: rating && Number(rating.ratingValue) ? { value: Number(rating.ratingValue), count: Number(rating.reviewCount || rating.ratingCount) || 0 } : null,
    reviews: [].concat(p.review || []).map((r) => ({ text: clean(r.reviewBody || r.description), name: clean(typeof r.author === "string" ? r.author : r.author?.name), stars: Number(r.reviewRating?.ratingValue) || 0 })).filter((r) => r.text),
  };
}

// ---------- (c) OpenGraph / meta + visible text ----------
export function parseMeta(html) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = (tag.match(/\b(?:property|name)=["']([^"']+)["']/i) || [])[1], v = (tag.match(/\bcontent=["']([\s\S]*?)["']\s*\/?>/i) || [])[1];
    if (k && v != null && !(k.toLowerCase() in meta)) meta[k.toLowerCase()] = clean(v);
  }
  return meta;
}
const BOILER = /cookie|privacy|subscribe|newsletter|copyright|all rights|log ?in|sign ?in|sign ?up|add to (cart|bag)|your cart|checkout|shipping|returns?|refund|terms|contact us|follow us|skip to|menu|javascript|wishlist|currency|powered by/i;
export function visibleFacts(html) {
  const body = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<body[\s\S]*<\/body>/i) || [html])[0]
    .replace(/<(nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ");
  const picks = [];
  for (const m of body.matchAll(/<(h[1-4]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) for (const l of linesOf(m[2])) picks.push({ tag: m[1].toLowerCase(), text: l });
  return picks.filter((p) => p.text.length >= 12 && p.text.length <= 240 && !BOILER.test(p.text) && !/^[\W\d]+$/.test(p.text));
}

// ---------- classify one line the way the page words it ----------
function kindOfLine(t) {
  if (looksLikeTestimonial(t)) return "testimonial";
  if (/\b(\d{1,3}\s?%.{0,60}(subjects|users|participants|agree|saw|reported|noticed)|clinical|consumer stud|dermatolog\w+ tested)/i.test(t)) return "study";
  if (/^(how to use|directions|usage|apply|when to use)\b|\b(apply (a|the|\d)|use (daily|twice|once|am|pm)|massage|leave (on|it)|rinse off|patch test)\b/i.test(t)) return "usage";
  if (/\b(suitable for|ideal for|skin types?|concerns?:|for (all|oily|dry|combination|sensitive|normal) (skin|types)|best for)\b/i.test(t)) return "suitability";
  return "claim";
}
const sentences = (s) => (s.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [s]).map((x) => x.trim()).filter((x) => x.length >= 12);

// ---------- build the sheet ----------
export function sheetFromGeneric({ url, host, title, brand, via, description = "", bullets = [], images = [], price = null, currency = "", rating = null, reviews = [], tags = [], day = new Date().toISOString().slice(0, 10) }) {
  const facts = [];
  const seen = new Set();
  const add = (section, kind, text) => {
    if (["claim", "suitability", "usage", "study"].includes(kind) && PROMO.test(text)) { if (/\b(\w*coins?|points?|cashback|coupon|promo|code|offer|\d+\s?%\s?off|off on|free (shipping|delivery|gift)|buy \d|get \d|bogo|emi|no[- ]cost|earn|reward|discount|deal|sale)\b/i.test(text) && !/delivery|review|rated|rating/i.test(text) && String(text).length <= 90) { kind = "offer"; section = "offer shown on the product page"; } else return; }
    const t = clean(text); const k = t.toLowerCase(); if (!t || seen.has(k) || facts.length >= 60) return; seen.add(k); const isOffer = kind === "offer"; facts.push({ ...(isOffer ? { line: t, day } : {}), id: isOffer ? `OFFER${facts.filter((f) => f.kind === "offer").length + 1}` : kind === "price" ? `PRICE${facts.filter((f) => f.kind === "price").length + 1}` : kind === "rating" ? "RATING" : kind === "review" ? `REV${facts.filter((f) => f.kind === "review").length + 1}` : `F${facts.filter((f) => !["price", "rating", "review", "offer"].includes(f.kind)).length + 1}`, section, kind, text: isOffer ? `"${t}" — as shown on ${host}, ${day}` : t }); };
  if (title) add("Product name", "name", title);
  for (const s of sentences(description)) if (s.length <= 240 && !BOILER.test(s)) add("Product description", kindOfLine(s), s);
  for (const b of bullets) add(b.section || "Product page", kindOfLine(b.text), b.text);
  for (const g of tags.slice(0, 6)) if (g && g.length <= 40 && /skin|hair|acne|oil|dry|sensitive|glow|pigment|dark|aging|hydrat/i.test(g)) add("Tags", "suitability", `Concern: ${g}`);
  const contentFacts = facts.filter((f) => !["name", "price", "rating", "review", "offer"].includes(f.kind)).length;
  if (price) add("price", "price", `Price: ${currency ? currency + " " : "Rs. "}${price} — ${host}, captured ${day}`);
  if (rating) add("reviews", "rating", `${rating.value} out of 5 stars${rating.count ? ` from ${rating.count.toLocaleString("en-IN")} reviews` : ""} on ${host}, captured ${day}`);
  for (const r of reviews.slice(0, 5)) add("customer review", "review", `"${r.text}" — ${r.name || "customer"}${r.stars ? `, ${r.stars}★` : ""} (${host}, captured ${day})`);
  if (contentFacts < MIN_FACTS) throw new Error(`Only ${contentFacts} usable fact(s) could be read from this page (at least ${MIN_FACTS} are needed, so nothing gets made up). Use "Enter manually" and paste the product name, tagline and claims.`);
  let slug = "";
  if (isMinimalistHost(host)) slug = (new URL(url).pathname.match(/\/products\/([^/?#]+)/) || [])[1] || "";
  else try { slug = slugify(`${host.replace(/^www\./, "").replace(/\.[a-z.]+$/, "")}-${new URL(url).pathname.split("/").filter(Boolean).pop() || title}`).slice(0, 80); } catch { slug = slugify(title).slice(0, 80); }
  return { url, title, actives: activesFromTitle(title), price, images: images.map((i) => abs(i, url)).filter(Boolean), facts, source: "page", brand: isMinimalistHost(host) ? "Minimalist" : brand || host.replace(/^www\./, ""), brand_site: isMinimalistHost(host) ? "minimalist" : "other", host, slug, extracted_via: via };
}

async function readPage(fetchImpl, url, accept = "text/html") {
  const r = await fetchImpl(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return { status: r.status, ok: r.ok, text: (await r.text()).replace(/^\uFEFF/, "") };
}

// The whole flow. fetchImpl is injectable so tests use saved HTML (no network).
// Minimalist only: other hosts are refused unless anyHost is set (tests / internal use). beminimalist.co pages use the dedicated
// parser first; this generic reader is the fallback when it cannot read a page.
export async function extractFromAnyUrl(raw, { fetchImpl = (...a) => fetch(...a), day, anyHost = false, dedicated = true } = {}) {
  const u = checkPublicUrl(raw);
  if (!isMinimalistHost(u.hostname) && !anyHost) throw new Error(NOT_MINIMALIST);
  if (isMinimalistHost(u.hostname) && dedicated) { try { return await extractFromUrl(raw); } catch { /* fall back to the generic reader below */ } }
  if (BLOCKING_SITES.test(u.hostname)) throw new Error(BLOCKED_MSG);
  let page;
  try { page = await readPage(fetchImpl, u.href); } catch (e) { throw new Error(`Couldn't reach that page (${e.message}). Check the link, or use "Enter manually".`); }
  if (!page.ok) throw new Error([401, 403, 429, 503].includes(page.status) ? BLOCKED_MSG : `The page answered HTTP ${page.status}. Check the link, or use "Enter manually".`);
  const html = page.text;
  if (/captcha|robot check|access denied|are you a human|unusual traffic/i.test(html.slice(0, 6000)) && html.length < 20000) throw new Error(BLOCKED_MSG);
  const host = u.hostname, meta = parseMeta(html), ld = parseJsonLd(html);
  // (a) Shopify: the product's own JSON.
  let js = null;
  const pm = u.pathname.match(/\/products\/([^/?#]+)/);
  if (pm && /cdn\.shopify\.com|Shopify\.(theme|shop)|shopify-features|myshopify\.com/i.test(html)) {
    try { const r = await readPage(fetchImpl, `${u.origin}/products/${pm[1]}.js`, "application/json"); if (r.ok) js = JSON.parse(r.text); } catch { js = null; }
  }
  const title = clean(js?.title || ld?.name || (meta["og:title"] || "").replace(/\s*[|–—-]\s*[^|–—-]*$/, "") || (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, " ") || "");
  if (!title) throw new Error('Couldn\'t find a product name on this page. Use "Enter manually".');
  const description = js?.description ? linesOf(js.description).join(" ") : ld?.description || meta["og:description"] || meta.description || "";
  const bullets = [];
  if (js?.description) for (const l of linesOf(js.description)) if (l.length <= 240 && !BOILER.test(l)) bullets.push({ section: "Product description", text: l });
  const needMore = sentences(description).length + bullets.length < 6;
  if (needMore || !js) for (const p of visibleFacts(html)) bullets.push({ section: p.tag.startsWith("h") ? "Page heading" : "Product page", text: p.text });
  const images = [...(js?.images || []), ...(ld?.images || []), meta["og:image"], meta["twitter:image"]].filter(Boolean);
  const price = js?.price ? js.price / 100 : ld?.price || Number(meta["product:price:amount"] || meta["og:price:amount"]) || null;
  const via = js ? "shopify" : ld ? "jsonld" : "opengraph";
  return sheetFromGeneric({
    url: u.href, host, title, brand: clean(js?.vendor || ld?.brand || meta["og:site_name"] || ""), via, description, bullets: description ? bullets.filter((b) => !sentences(description).includes(b.text)) : bullets,
    images: [...new Set(images)], price, currency: ld?.currency || meta["product:price:currency"] || "", rating: ld?.rating || null, reviews: ld?.reviews || [], tags: js?.tags || [], day,
  });
}



