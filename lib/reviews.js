// Verified customer reviews captured from the brand site (brand_packs/minimalist/raw/reviews_<date>.json, Yotpo,
// user decision 2026-10-03: real reviews, verbatim and attributed). One screen for the library pipeline and the app.
// A star rating alone is not enough (a 5-star "it got worse, can't see any difference" passed the capture filter):
// negative or mixed wording, very short reviews and price complaints are never offered.
import fs from "node:fs";

const DIR = new URL("../brand_packs/minimalist/raw/", import.meta.url);
export const NEG = /\b(complain|worst|worse|bad|waste|disappoint|no (difference|result|change)|can'?t see|not (working|work|good|effective|see|satisf|happy|suit)|didn'?t|doesn'?t|breakout|broke out|irritat|allerg|rash|burn|itch|sting|pimples? (are )?coming|expensive|costly|affordable|refund|fake|duplicate|but\b|problem|issue|lekin|lykin|par\b|nahi|nhi)/i;

let cache = null;
function load() {
  if (cache) return cache;
  const f = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((x) => /^reviews_.*\.json$/.test(x)).sort().pop() : null;
  cache = f ? { day: f.slice(8, 18), products: JSON.parse(fs.readFileSync(new URL(f, DIR), "utf8")).products || {} } : { day: "", products: {} };
  return cache;
}

// The product's rating and its usable reviews, best first as captured (at most 6).
export function goodReviews(handle) {
  const { day, products } = load();
  const p = products[handle];
  if (!p?.reviews) return { day, average: null, total: 0, reviews: [] };
  const reviews = p.reviews.filter((r) => r.usable && r.verified && !NEG.test(r.text) && r.text.split(/\s+/).length >= 8).slice(0, 6);
  return { day, average: p.average || null, total: p.total_reviews || 0, reviews };
}
