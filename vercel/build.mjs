// Vercel build (Build Output API v3), run by Vercel from the GitHub copy: `node vercel/build.mjs`.
// Vercel caps one function at 250 MB and the images are ~900 MB, so they are split:
//   - static/: every image at its own repo path (plus public/ at the site root), served by Vercel's CDN
//   - functions/index.func/: server.js and all other files, with each image as an empty stand-in so the code's file
//     checks still pass; server.js sendFile redirects an image to its static path when VERCEL is set.
import fs from "node:fs";
import path from "node:path";

const OUT = ".vercel/output";
const FN = path.join(OUT, "functions", "index.func");
const SKIP = new Set([".git", ".vercel", "node_modules", "docs", "cache", "vercel"]);
const IMG = /\.(png|jpe?g|webp)$/i;
fs.rmSync(OUT, { recursive: true, force: true });

const put = (dst, src) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); src === null ? fs.writeFileSync(dst, "") : fs.copyFileSync(src, dst); };
let images = 0, other = 0;
(function walk(dir) {
  for (const d of fs.readdirSync(dir || ".", { withFileTypes: true })) {
    const rel = dir ? path.join(dir, d.name) : d.name;
    if (!dir && SKIP.has(d.name)) continue;
    if (d.isDirectory()) { walk(rel); continue; }
    if (IMG.test(d.name)) { put(path.join(OUT, "static", rel), rel); put(path.join(FN, rel), null); images++; }
    else { put(path.join(FN, rel), rel); other++; }
  }
})("");
fs.cpSync("public", path.join(OUT, "static"), { recursive: true });

fs.writeFileSync(path.join(FN, "vercel_entry.mjs"), `process.env.ONLINE = "1";\nconst { app } = await import("./server.js");\nexport default app;\n`);
fs.writeFileSync(path.join(FN, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "vercel_entry.mjs", launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 300 }, null, 2));
fs.writeFileSync(path.join(OUT, "config.json"), JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }] }, null, 2));
console.log(`${images} images to static, ${other} other files into the function`);
