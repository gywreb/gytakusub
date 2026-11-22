// An unpacked Gytakusub reloads itself when its folder's dev-reload.txt changes (extension/devreload.js);
// one from a store never looks.
import { checkDevReload, MARK_KEY } from "../extension/devreload.js";

let passes = 0, failures = 0;
const ok = (cond, name, extra = "") => { if (cond) { passes++; console.log("ok -", name); } else { failures++; console.log("not ok -", name, extra); } };

/** A fake chrome namespace: one extension, its session storage, and a folder with (or without) the mark. */
function fakeChrome(installType) {
  const session = {}, state = { reloads: 0, file: null, fetches: 0 };
  const api = {
    management: { getSelf: async () => ({ installType }) },
    runtime: { getURL: (p) => `chrome-extension://id/${p}`, reload: () => { state.reloads++; for (const k in session) delete session[k]; } },
    storage: { session: { get: async (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k in session ? session[k] : v])), set: async (o) => Object.assign(session, o) } },
  };
  const fetchFn = async (url) => { state.fetches++; if (!url.endsWith("/dev-reload.txt")) throw new Error(url); if (state.file === null) throw new TypeError("Failed to fetch"); return { ok: true, text: async () => state.file }; };
  return { api, fetchFn, state, session };
}

{ // from a store: never fetches the mark, never reloads
  const c = fakeChrome("normal"); c.state.file = "a";
  ok(await checkDevReload(c.api, c.fetchFn) === "store" && c.state.fetches === 0 && c.state.reloads === 0, "an install from a store never looks for the mark");
  const d = fakeChrome("normal"); d.api.management = undefined;
  ok(await checkDevReload(d.api, d.fetchFn) === "store", "no management API: treated as a store install");
}
{ // unpacked, no mark file yet: takes "none"; the file appearing reloads
  const c = fakeChrome("development");
  ok(await checkDevReload(c.api, c.fetchFn) === "first", "first start takes the mark (no file)");
  ok(await checkDevReload(c.api, c.fetchFn) === "same", "a later start with no change does nothing");
  c.state.file = "2.15.0 1";
  ok(await checkDevReload(c.api, c.fetchFn) === "reload" && c.state.reloads === 1, "the file appearing reloads");
  ok(!(MARK_KEY in c.session), "the reload clears the mark");
  ok(await checkDevReload(c.api, c.fetchFn) === "first" && c.session[MARK_KEY] === "2.15.0 1", "after the reload the new start takes the file as it is");
  ok(await checkDevReload(c.api, c.fetchFn) === "same" && c.state.reloads === 1, "and does not reload again");
  c.state.file = " 2.15.0 1\n";
  ok(await checkDevReload(c.api, c.fetchFn) === "same", "whitespace around the mark is not a change");
  c.state.file = "2.15.0 2";
  ok(await checkDevReload(c.api, c.fetchFn) === "reload" && c.state.reloads === 2, "a changed mark reloads");
  ok(await checkDevReload(c.api, c.fetchFn) === "first", "(the new start after that reload)");
  c.state.file = null;
  ok(await checkDevReload(c.api, c.fetchFn) === "reload" && c.state.reloads === 3, "the file removed is a change too");
  ok(await checkDevReload(c.api, c.fetchFn) === "first" && await checkDevReload(c.api, c.fetchFn) === "same", "and then settles");
}

console.log(failures ? `DEV RELOAD TESTS FAILED (${failures} of ${failures + passes})` : `DEV RELOAD TESTS PASSED (${passes})`);
process.exitCode = failures ? 1 : 0;
