// Gytakusub Web – the Claude usage log (usage.js) in this browser's storage.
// Each Claude answer adds its tokens; the Settings sheet and the toolbar show them.
// An installed app on a computer shares this storage with the browser it came from
// (the same site), and open tabs see each other's updates. On iPhone and iPad a
// Home Screen app has its own storage, so it keeps its own log.
import { addCall, emptyLog } from "./usage.js";

const KEY = "gytakusub.claudeUsage";
const listeners = new Set();

export function readClaudeUsage() {
  try { const log = JSON.parse(localStorage.getItem(KEY) || "null"); return log?.v === 1 ? log : emptyLog(); }
  catch { return emptyLog(); }
}

function write(log) {
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* storage full or blocked: keep showing what we have */ }
  for (const fn of listeners) fn(log);
}

/** Adds one Claude answer ({usage, model, limits} as callClaude returns them). */
export function recordClaudeUsage(r) {
  if (r?.usage) write(addCall(readClaudeUsage(), { model: r.model, usage: r.usage, limits: r.limits }));
}

export function clearClaudeUsage() { write(emptyLog()); }

/** Calls fn(log) on every change, here or in another tab of this site. */
export function onClaudeUsage(fn) { listeners.add(fn); }
addEventListener("storage", (e) => { if (e.key === KEY) for (const fn of listeners) fn(readClaudeUsage()); });
