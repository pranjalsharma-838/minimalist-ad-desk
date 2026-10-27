// The Claude key for the request being handled (online version, 2026-10-27: "anyone with the link can open it", each
// visitor brings their own key). server.js runs every request inside keyStore.run({ claude }) with the key the visitor's
// browser sent in the x-claude-key header; lib/llm.js reads it here. The key lives only for that request: never stored,
// never shared with another visitor, never logged. Without one, a key from .env (local use) still applies.
import { AsyncLocalStorage } from "node:async_hooks";

export const keyStore = new AsyncLocalStorage();
export const claudeKey = () => keyStore.getStore()?.claude || process.env.ANTHROPIC_API_KEY || "";
