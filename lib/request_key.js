// The Claude key for the request being handled (online version, 2026-10-27: "anyone with the link can open it", each
// visitor brings their own key). server.js runs every request inside keyStore.run({ claude }) with the key the visitor's
// browser sent in the x-claude-key header; lib/llm.js reads it here. The key lives only for that request: never stored,
// never shared with another visitor, never logged. Without one, a key from .env (local use) still applies.
import { AsyncLocalStorage } from "node:async_hooks";

export const keyStore = new AsyncLocalStorage();
export const claudeKey = () => keyStore.getStore()?.claude || process.env.ANTHROPIC_API_KEY || "";
// The visitor's OpenAI key (x-openai-key header), the same way (2026-10-28: "make gpt images work online").
export const openaiKey = () => keyStore.getStore()?.openai || process.env.OPENAI_API_KEY || "";
// Online new images keep no state on the server: the visitor's browser holds each image job and its result, and sends the
// jobs' states with its requests (inputs.images, set by server.js). Jobs created while handling a request are collected
// in `queued` and returned to the browser, which then makes them through /api/make-image.
export const requestImages = () => keyStore.getStore()?.images || {};
export const queuedHere = () => keyStore.getStore()?.queued;
