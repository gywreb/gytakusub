// The web app's LaMa guard (web/lama-guard.js): a phone whose tab died twice while LaMa loaded or
// first ran keeps to AOT; one that filled with it keeps LaMa; a tab closed once mid-load is forgiven.
import assert from "node:assert/strict";
import { lamaAllowed, lamaSeen, lamaState } from "../web/lama-guard.js";

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok - " + name); };

ok("a device that never tried may try", () => {
  const s = store();
  assert.equal(lamaState(s), "untried");
  assert.equal(lamaAllowed(s), true);
});

ok("a tab that died once while LaMa loaded may try again", () => {
  const s = store();
  lamaAllowed(s); lamaSeen("loading", s);        // the tab dies here
  assert.equal(lamaAllowed(s), true);           // next visit
  assert.equal(lamaState(s), "again");
});

ok("dying twice keeps the device to AOT from then on", () => {
  const s = store();
  lamaAllowed(s); lamaSeen("loading", s);
  lamaAllowed(s); lamaSeen("loading", s);       // dies again
  assert.equal(lamaAllowed(s), false);
  assert.equal(lamaState(s), "off");
  assert.equal(lamaAllowed(s), false);          // and stays so
});

ok("once LaMa has filled, later loads are not counted against it", () => {
  const s = store();
  lamaAllowed(s); lamaSeen("loading", s); lamaSeen("ok", s);
  for (let i = 0; i < 3; i++) { assert.equal(lamaAllowed(s), true); lamaSeen("loading", s); }
  assert.equal(lamaState(s), "ok");
});

ok("a second try that fills clears the first death", () => {
  const s = store();
  lamaAllowed(s); lamaSeen("loading", s);
  lamaAllowed(s); lamaSeen("loading", s); lamaSeen("ok", s);
  assert.equal(lamaAllowed(s), true);
  assert.equal(lamaState(s), "ok");
});

ok("a browser that refuses storage just tries LaMa", () => {
  const bad = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(lamaAllowed(bad), true);
  lamaSeen("loading", bad);
  assert.equal(lamaState(bad), "unknown");
});

console.log(`\nLAMA GUARD TESTS PASSED (${passed})`);
