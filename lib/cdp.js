// Minimal headless-browser driver over the Chrome DevTools Protocol, using Node's built-in fetch and WebSocket:
// nothing to install. Used by the weekly Meta Ad Library check (scripts/adlib_weekly.js).
// Every call has a timeout, and a dropped connection fails the pending calls instead of leaving them waiting
// (the first unattended test hung that way: the browser connection closed and the script waited forever).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same browser search as pipeline/08b_png.js; BROWSER overrides.
export const BROWSER = [process.env.BROWSER, `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"].find((p) => p && fs.existsSync(p));

const live = new Set();
// If the script dies for any reason, don't leave hidden browsers behind.
process.on("exit", () => { for (const p of live) try { p.kill(); } catch {} });

// Options: headless (default true), callTimeout, and profileDir. With no profileDir (every existing caller) the profile is a
// fresh throwaway folder deleted on close(). With profileDir the profile is kept between runs (logins and cookies stay),
// and if a browser from an earlier run is still open on that profile it is attached to instead of started again.
export async function launch({ headless = true, callTimeout = 60000, profileDir = "", attachPort = 0 } = {}) {
  if (!BROWSER) throw new Error("No Edge/Chrome/Chromium found; set BROWSER=/path/to/browser.");
  const persistent = Boolean(profileDir);
  const profile = persistent ? path.resolve(profileDir) : fs.mkdtempSync(path.join(os.tmpdir(), "adlib-"));
  if (persistent) fs.mkdirSync(profile, { recursive: true });
  let port = 9300 + Math.floor(Math.random() * 600);
  let proc = null;
  const probe = async (p) => { try { await (await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(2000) })).json(); return true; } catch { return false; } };
  // Chrome/Edge write the debugging port of a running browser into <profile>/DevToolsActivePort.
  let attached = false;
  // attachPort: open another tab in a browser this process already started (Edge does not always write DevToolsActivePort).
  if (attachPort && (await probe(attachPort))) { port = attachPort; attached = true; }
  if (persistent && !attached) {
    try {
      const p = Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]);
      if (p && (await probe(p))) { port = p; attached = true; }
    } catch { /* no browser running on this profile */ }
  }
  if (!attached) {
    const size = headless ? "--window-size=1366,2400" : "--window-size=1280,900";
    const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", size, "--lang=en-US", "about:blank"];
    proc = spawn(BROWSER, headless ? ["--headless=new", ...args] : args, { stdio: "ignore" });
    live.add(proc);
  }
  const base = `http://127.0.0.1:${port}`;
  let ready = attached;
  for (let i = 0; i < 75 && !ready; i++) {
    if (await probe(port)) ready = true; else await sleep(200);
  }
  if (!ready) { try { proc?.kill(); } catch {} if (proc) live.delete(proc); throw new Error("Browser did not start"); }
  const tab = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(10000) })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("DevTools connection failed")); });
  let seq = 0;
  let closed = null;
  const pending = new Map();
  const failAll = (why) => {
    closed = why;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
    pending.clear();
  };
  ws.onclose = () => failAll("browser connection closed");
  ws.onerror = () => failAll("browser connection error");
  proc?.on("exit", () => failAll("browser exited"));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const send = (method, params = {}, timeout = callTimeout) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error(closed));
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out after ${timeout / 1000}s`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Runtime.enable");

  const page = {
    send,
    get alive() { return !closed; },
    // Runs a function in the page (arguments are JSON-serialised) and returns its JSON result.
    async eval(fn, ...args) {
      const expression = typeof fn === "function" ? `(${fn})(...${JSON.stringify(args)})` : fn;
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: callTimeout - 5000 });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) { await send("Page.navigate", { url }); },
    // Polls until fn() in the page returns something truthy (or the timeout passes) and returns it.
    async waitFor(fn, { timeout = 30000, every = 750 } = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (closed) throw new Error(closed);
        const v = await page.eval(fn).catch(() => null);
        if (v) return v;
        await sleep(every);
      }
      return null;
    },
    // Throwaway profile: closes the browser and deletes the profile. Persistent profile: closes the browser (or, when it
    // was attached to, only this tab) and keeps the profile.
    async close() {
      try { ws.close(); } catch {}
      if (proc) { try { proc.kill(); } catch {} live.delete(proc); }
      else { try { await fetch(`${base}/json/close/${tab.id}`, { signal: AbortSignal.timeout(5000) }); } catch {} }
      await sleep(800);
      if (!persistent) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
    },
    get tabId() { return tab.id; },
    get port() { return port; },
  };
  return page;
}
