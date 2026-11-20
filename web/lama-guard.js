// LaMa on a phone: its first load and fill are marked here, so a tab that died of them (out of memory:
// the tab reloads, nothing can catch it) finds the mark. A second unfinished try (a first could be a
// tab closed while it loaded) keeps the app to AOT from then on. "ok" once it has filled at full size
// (engine/page.js warmInpainter). `store` is localStorage; a browser that refuses it just tries LaMa.
const KEY = "gytakusub.lama";

/** Whether a new engine may load LaMa; counts an unfinished try found from before. */
export function lamaAllowed(store = globalThis.localStorage) {
  try {
    const v = store.getItem(KEY);
    if (v === "trying") store.setItem(KEY, "again");
    if (v === "trying-again") store.setItem(KEY, "off");
    return store.getItem(KEY) !== "off";
  } catch { return true; }
}

/** The engine's news: "loading" (about to make its session) or "ok" (it filled). */
export function lamaSeen(state, store = globalThis.localStorage) {
  try {
    const v = store.getItem(KEY);
    if (state === "ok") store.setItem(KEY, "ok");
    else if (v !== "ok") store.setItem(KEY, v === "again" ? "trying-again" : "trying");
  } catch {}
}

/** For the debug report: untried, trying, again, trying-again, off or ok. */
export function lamaState(store = globalThis.localStorage) {
  try { return store.getItem(KEY) || "untried"; } catch { return "unknown"; }
}
