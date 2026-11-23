// A Gytakusub loaded unpacked from a folder (developing it, or testing a branch) reloads itself when
// the file dev-reload.txt next to its manifest changes. Whoever switches the folder's code (a test
// run checking out a branch) writes that file, and the browser runs the new code without anyone
// clicking Reload on its extensions page. The file is git-ignored, and an install from a store never
// looks for it.
//
// The worker sleeps when idle and starts again later, so the mark it compares with is kept in session
// storage, which lasts until the extension reloads: a worker that wakes after the file changed still
// sees the change, and the reload clears the mark, so the next start takes the file as it then is.

export const MARK_FILE = "dev-reload.txt";
export const MARK_KEY = "devReloadMark";
const NONE = "(none)";

/** The marker file's contents, or NONE when there is no such file. */
async function readMark(api, fetchFn) {
  try {
    const res = await fetchFn(api.runtime.getURL(MARK_FILE), { cache: "no-store" });
    return res.ok ? (await res.text()).trim() : NONE;
  } catch { return NONE; }
}

/**
 * Reload when the marker changed since this extension loaded. Returns what it did: "store" (not
 * unpacked: never checks), "first" (took the mark), "same" or "reload".
 * @param {any} [api] the chrome namespace (tests pass a fake one)
 * @param {typeof fetch} [fetchFn]
 */
export async function checkDevReload(api = globalThis.chrome, fetchFn = globalThis.fetch) {
  const self = await api.management?.getSelf?.().catch(() => null);
  if (self?.installType !== "development") return "store";
  const now = await readMark(api, fetchFn);
  const seen = (await api.storage.session.get({ [MARK_KEY]: null }))[MARK_KEY];
  if (seen === null) { await api.storage.session.set({ [MARK_KEY]: now }); return "first"; }
  if (seen === now) return "same";
  api.runtime.reload();
  return "reload";
}

let last = 0;
/** checkDevReload at most every two seconds (a page connecting, the worker starting). */
export function devReloadSoon() {
  const t = Date.now();
  if (t - last < 2000) return;
  last = t;
  checkDevReload().catch(() => {});
}
