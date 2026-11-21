// extension/engine/tuning.js: every value is a number (or a list of numbers), frozen, and used by
// the engine; nothing changes them unless GYT_TUNE asks (the bench).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tuning from "../extension/engine/tuning.js";

const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../extension/engine");
const sources = fs.readdirSync(engine).filter((f) => f.endsWith(".js") && f !== "tuning.js").map((f) => fs.readFileSync(path.join(engine, f), "utf8")).join("\n");
let checks = 0;

assert.equal(globalThis.GYT_TUNE, undefined);
for (const [stage, values] of Object.entries(tuning)) {
  assert.ok(Object.isFrozen(values), `${stage} is frozen`);
  for (const [k, v] of Object.entries(values)) {
    const ok = Array.isArray(v) ? Object.isFrozen(v) && v.every(Number.isFinite) : Number.isFinite(v);
    assert.ok(ok, `${stage}.${k} is a number`);
    // a value nothing reads would say the engine depends on it
    assert.ok(new RegExp(`\\b${stage}\\.${k}\\b`).test(sources), `${stage}.${k} is used by the engine`);
    checks++;
  }
}
console.log(`tuning: ${checks} values, each a number and used`);
