// Index of Minimalist's own products, built from the dated catalog snapshot.
// Used to (a) check stated concentrations against what the brand actually sells and
// (b) mask product names so "Lip Treatment Balm" or "Healing Ointment" don't trip the
// drug-claim rule just by being named.
// Limitation: the snapshot is a point-in-time copy (research/products_snapshot_2026-10-02.json);
// a launch after that date is unknown to the scorer until the snapshot is refreshed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activesFromTitle } from "./extract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(here, "..", "research", "products_snapshot_2026-10-02.json");

export const normPct = (p) => String(p).replace(/%/g, "").replace(/^0+(?=\d)/, "") ;

function load() {
  const { products } = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const titles = [];
  const actives = new Map(); // token (lowercase) -> Set of normalized pct strings
  for (const p of products) {
    const title = p.title.replace(/^🎁\s*-?\s*/, "").trim();
    titles.push(title);
    for (const a of activesFromTitle(title)) {
      if (a.name === "SPF") continue;
      // "Salicylic + LHA" -> tokens ["salicylic", "lha"]; the % belongs to the combination,
      // so each token is allowed that %.
      for (const tok of a.name.split(/\s*\+\s*|\s*&\s*/)) {
        const key = tok.toLowerCase().replace(/\b(acid|face|serum)\b/g, "").replace(/\s+/g, " ").trim();
        if (!key) continue;
        if (!actives.has(key)) actives.set(key, new Set());
        actives.get(key).add(normPct(a.pct));
      }
    }
  }
  // Longest first so masking prefers the full product name.
  titles.sort((a, b) => b.length - a.length);
  return { titles, actives, snapshotDate: "2026-10-02" };
}

export const CATALOG = load();

// Returns the known concentrations for an ingredient mention, or null if the ingredient
// isn't a headline active of any Minimalist product.
// Format / body-area words that follow a % on Minimalist packs ("10% Face Serum") — never an ingredient.
const FORMAT_WORDS = /^(face|serum|body|hair|lip|eye|under|cleanser|moisturi[sz]er|toner|lotion|cream|oil|wash|shampoo|mask|peel|gel|balm|spray|sunscreen|off|more|less|of|pure|in|the|and|subjects|users|people)\b/i;

export function knownPcts(ingredient) {
  // Bug found on the tuning set: "10% Serum" stripped to "" and "".includes matched every active.
  if (FORMAT_WORDS.test(ingredient.trim())) return null;
  const key = ingredient.toLowerCase().replace(/\b(acid|face|serum)\b/g, "").replace(/\s+/g, " ").trim();
  if (key.length < 3) return null;
  if (CATALOG.actives.has(key)) return [...CATALOG.actives.get(key)];
  // Union of ALL partial matches, not the first one: "AHA" is in both "AHA BHA 10%" and
  // "AHA PHA BHA 32%" (returning only the first caused a false block on the first gate run).
  const out = new Set();
  for (const [k, v] of CATALOG.actives) if (k.length >= 3 && (key.includes(k) || k.includes(key))) v.forEach((x) => out.add(x));
  return out.size ? [...out] : null;
}
