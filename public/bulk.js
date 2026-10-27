// Bulk scoring helpers for the "Score any ad" tab: read a CSV or XLSX of ad copy, turn a score report into one table row,
// sort / filter the results, write them back out as CSV. Pure functions (no DOM, no network): the browser app and node:test
// (tests/bulk.test.js) share one copy. XLSX is read with the browser's own zip support (DecompressionStream): no packages.

export const COPY_COLUMNS = ["headline", "primary_text", "on_image_text", "footnote", "cta", "ad_type", "product_url"];
export const MAX_ROWS = 300;

// A template people can fill in (two example rows; the second is a creator ad).
export const TEMPLATE_CSV = [
  COPY_COLUMNS.join(","),
  `"Niacinamide 10% Face Serum","Apply 2-3 drops after cleansing, AM and PM. Suitable for 18+ years of age.","10% Niacinamide","Patch test before use","Shop now",brand,https://beminimalist.co/products/niacinamide-10-with-matmarine`,
  `"My honest take on this serum","Used it for a month, my skin feels smoother. #ad","","","Learn more",creator,`,
].join("\r\n") + "\r\n";

// ---------- CSV (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes; comma, semicolon or tab) ----------
export function parseCsv(text) {
  let s = String(text || "").replace(/^﻿/, "");
  const first = s.split(/\r?\n/, 1)[0];
  const counts = [",", ";", "\t"].map((c) => [c, first.split(c).length - 1]).sort((a, b) => b[1] - a[1]); // ties keep the comma
  const delim = counts[0][1] ? counts[0][0] : ",";
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// ---------- XLSX (a zip of XML files; the first worksheet) ----------
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// { name: () => Promise<Uint8Array> } for every file in the zip, read from its central directory (stored or deflated).
export function readZip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This is not a valid .xlsx file (no zip directory found).");
  const n = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = new Map();
  for (let k = 0; k < n; k++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("This .xlsx file looks damaged.");
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    files.set(name, async () => {
      const lnlen = u16(b, off + 26), lxlen = u16(b, off + 28), start = off + 30 + lnlen + lxlen;
      const data = b.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error(`This .xlsx uses an unsupported compression (${method}).`);
    });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

// The first worksheet as an array of rows (arrays of strings).
export async function parseXlsx(buf) {
  const files = readZip(buf);
  const read = async (name) => (files.has(name) ? new TextDecoder().decode(await files.get(name)()) : "");
  const shared = [...(await read("xl/sharedStrings.xml")).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  // the first sheet listed in the workbook, else the lowest-numbered worksheet file
  let sheetName = "";
  const wb = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels");
  const rid = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
  const target = rid && [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
  if (target) sheetName = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  if (!sheetName || !files.has(sheetName)) sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1]) - parseInt(b.match(/(\d+)\.xml$/)[1]))[0] || "";
  if (!sheetName) throw new Error("No worksheet found in this .xlsx file.");
  const xml = await read(sheetName);
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || "";
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = "";
      if (type === "s") val = shared[Number(v)] ?? "";
      else if (type === "inlineStr") val = textOf(inner);
      else if (type === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) val = unxml(v);
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = val;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// ---------- table -> ad rows ----------
const ALIAS = {
  headline: ["headline", "title", "head_line"],
  primary_text: ["primary_text", "primary", "primary_copy", "caption", "body", "ad_copy", "text"],
  on_image_text: ["on_image_text", "on_image", "image_text", "text_on_image", "overlay_text"],
  footnote: ["footnote", "foot_note", "small_print", "disclaimer"],
  cta: ["cta", "call_to_action", "button"],
  ad_type: ["ad_type", "type", "adtype"],
  product_url: ["product_url", "url", "product", "product_link", "link"],
};
const norm = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export const adTypeOf = (v) => (/creator|partner|ugc|influenc|collab|paid/i.test(String(v || "")) ? "creator" : "brand");

// rows: array of arrays (first row = column names). Returns { ads: [{ad, product_url, row}], columns, ignored, problems }.
export function adsFromTable(rows) {
  const problems = [];
  if (!rows?.length) return { ads: [], columns: [], ignored: [], problems: ["The file is empty."] };
  const head = rows[0].map(norm);
  const map = {};
  for (const [key, names] of Object.entries(ALIAS)) { const i = head.findIndex((h) => names.includes(h)); if (i >= 0) map[key] = i; }
  const used = new Set(Object.values(map));
  const ignored = rows[0].filter((_, i) => !used.has(i) && String(rows[0][i]).trim());
  if (!["headline", "primary_text", "on_image_text", "footnote", "cta"].some((k) => k in map)) {
    return { ads: [], columns: Object.keys(map), ignored, problems: [`No ad text columns found. The first row must name the columns: ${COPY_COLUMNS.join(", ")}.`] };
  }
  const ads = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k) => (k in map ? String(r[map[k]] ?? "").trim() : "");
    const ad = { ad_type: adTypeOf(get("ad_type")), headline: get("headline"), primary_text: get("primary_text"), on_image_text: get("on_image_text"), footnote: get("footnote"), cta: get("cta") };
    if (![ad.headline, ad.primary_text, ad.on_image_text, ad.footnote, ad.cta].some(Boolean)) return; // an empty line
    const url = get("product_url");
    ads.push({ ad, product_url: /^https?:\/\//i.test(url) ? url : "", row: i + 2 });
    if (url && !/^https?:\/\//i.test(url)) problems.push(`Row ${i + 2}: the product_url is not a web address, so it was left out.`);
  });
  if (ads.length > MAX_ROWS) problems.push(`Only the first ${MAX_ROWS} rows are used (the file has ${ads.length}).`);
  return { ads: ads.slice(0, MAX_ROWS), columns: Object.keys(map), ignored, problems };
}

// ---------- one report -> one table row ----------
const SEV_ORDER = { block: 0, fix: 1, advisory: 2 };
const SEV_TEXT = { block: "Block", fix: "Must fix", advisory: "Advisory" };
export const toPct = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n <= 1 && n > 0 ? n * 100 : n) : null);

export const VERDICT_KEYS = [
  { key: "ready", label: "Ready for review", rank: 2 },
  { key: "rules", label: "Rules only", rank: 1 },
  { key: "fix", label: "Needs fixes", rank: 3 },
  { key: "blocked", label: "Blocked", rank: 4 },
];
export function verdictKeyOf(report) {
  const c = report?.scores?.compliance?.code === "BLOCKED" ? "BLOCKED" : report?.verdict?.code;
  return { READY_FOR_REVIEW: "ready", NEEDS_CHANGES: "fix", BLOCKED: "blocked", LIMITED_CHECK: "rules" }[c] || "";
}
export function topFindings(report, n = 3) {
  return [...(report?.findings || [])].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)).slice(0, n)
    .map((f) => `${SEV_TEXT[f.severity] || f.severity}: ${f.rule_id}${f.title ? ` ${f.title}` : ""}${f.span ? ` ("${String(f.span).slice(0, 50)}")` : ""}`);
}
// The flat fields the table and the CSV show.
export function summarise(report) {
  const sc = report?.scores || {};
  return {
    verdict: verdictKeyOf(report), verdictLabel: report?.verdict?.label || "",
    alignment: toPct(sc.alignment?.score), alignmentBand: sc.alignment?.band || "",
    win: toPct(sc.win?.score), winBand: sc.win?.band || "",
    compliance: sc.compliance?.label || sc.compliance?.code || report?.verdict?.label || "",
    findings: topFindings(report, 3), findingCount: (report?.findings || []).length,
    headline: report?.ad?.headline || "",
  };
}

// ---------- sort / filter / export ----------
export const RESULT_COLUMNS = ["order", "name", "verdict", "alignment", "win", "findings"];
// rows: [{ order, name, status, verdict, alignment, win, findingCount, ... }]. Unscored rows always sort last.
export function sortRows(rows, key = "order", dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  const val = {
    order: (r) => r.order, name: (r) => String(r.name || "").toLowerCase(),
    verdict: (r) => VERDICT_KEYS.find((v) => v.key === r.verdict)?.rank ?? null,
    alignment: (r) => r.alignment ?? null, win: (r) => r.win ?? null, findings: (r) => (r.status === "done" ? r.findingCount ?? 0 : null),
  }[key] || ((r) => r.order);
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return a.order - b.order;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sign || a.order - b.order;
  });
}
// verdict: "" (all) | ready | rules | fix | blocked | pending (not scored: waiting, needs the key, or failed)
export function filterRows(rows, { verdict = "", q = "" } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (verdict === "pending" ? r.status === "done" : verdict && r.verdict !== verdict) return false;
    if (!words.length) return true;
    const hay = [r.name, r.headline, r.verdictLabel, r.compliance, r.error, ...(r.findings || [])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const STATUS_TEXT = { queued: "Waiting", scoring: "Scoring", done: "Scored", error: "Failed", needs_key: "Needs the API key to read the image text" };
export const statusText = (r) => (r.status === "error" ? `Failed: ${r.error || "unknown error"}` : STATUS_TEXT[r.status] || r.status);

// A CSV cell: quoted when needed; a leading = + - @ is defused so a spreadsheet never runs it as a formula.
export const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function resultsToCsv(rows) {
  const head = ["row", "source", "headline", "status", "verdict", "alignment", "alignment_band", "win", "win_band", "compliance", "findings", "finding_count", "note"];
  const lines = [head.join(",")];
  for (const r of [...rows].sort((a, b) => a.order - b.order)) {
    lines.push([r.order, r.name, r.headline, STATUS_TEXT[r.status] || r.status, r.verdictLabel, r.alignment ?? "", r.alignmentBand, r.win ?? "", r.winBand, r.compliance, (r.findings || []).join(" | "), r.status === "done" ? r.findingCount ?? 0 : "", r.status === "done" ? r.note || "" : r.error || (r.status === "needs_key" ? STATUS_TEXT.needs_key : "")].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// Runs fn over items, `limit` at a time; stops starting new ones once shouldStop() says so. Resolves when all started ones end.
export async function runPool(items, limit, fn, shouldStop = () => false) {
  let next = 0;
  const worker = async () => { while (next < items.length && !shouldStop()) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
