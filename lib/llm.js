// One structured-output call to the Claude Messages API, with refusal fallback.
// Raw HTTP via Node's built-in fetch: nothing to install (the laptop this was built on doesn't
// allow installs, and it keeps setup to `node server.js`).
// Prompts live in prompts/*.md and are loaded from disk on every call (no prompt text in code).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./env.js";
import { claudeKey } from "./request_key.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MODEL = process.env.MODEL || "claude-opus-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export const llmAvailable = () => Boolean(claudeKey());

export function loadPrompt(name, vars = {}) {
  let text = fs.readFileSync(path.join(here, "..", "prompts", name), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  return text;
}

// Returns { data, usage, model } or throws with a readable message.
export async function structuredCall({ system, user, schema, effort = "medium", maxTokens = 16000, model = MODEL }) {
  if (!llmAvailable()) throw new Error("No ANTHROPIC_API_KEY set");
  const content = Array.isArray(user) ? user : [{ type: "text", text: user }];
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": claudeKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      fallbacks: "default",
      // System prompt (rulebook) is identical across calls -> cache it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { effort, format: { type: "json_schema", schema } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error(`API key rejected: ${msg}`);
    if (res.status === 429) throw new Error(`Rate limited, try again shortly: ${msg}`);
    throw new Error(`Claude API error ${res.status}: ${msg}`);
  }
  if (body.stop_reason === "refusal") {
    throw new Error(`Model declined (${body.stop_details?.category ?? "unspecified"}). Treat as not assessed.`);
  }
  if (body.stop_reason === "max_tokens") throw new Error("Model output was cut off (max_tokens).");
  const text = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(text), usage: body.usage, model: body.model };
}
