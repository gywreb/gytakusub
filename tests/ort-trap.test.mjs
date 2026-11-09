// If the model runtime traps (a WebAssembly RuntimeError: its memory is no longer
// trustworthy), engine/ort.js must stop using it rather than fail every page
// after: it records the failure, later calls fail fast with a clear message, and
// the engine's loaders hand out the OpenCV text detector and no bubble model.
// Runs in its own process: the "broken" state is per worker, like the extension's.
import assert from "node:assert/strict";
import { run, ortBroken } from "../extension/engine/ort.js";

let passed = 0;
const ok = (name) => { passed++; console.log("ok -", name); };

assert.equal(ortBroken(), null);
await assert.rejects(run({ run: async () => { throw new Error("input shape mismatch"); } }, {}), /input shape mismatch/);
assert.equal(ortBroken(), null); ok("an ordinary model error does not stop the runtime");

let order = [];
const slow = (id, ms) => ({ run: async () => { order.push(`start ${id}`); await new Promise((r) => setTimeout(r, ms)); order.push(`end ${id}`); return id; } });
assert.deepEqual(await Promise.all([run(slow("a", 30), {}), run(slow("b", 1), {}), run(slow("c", 10), {})]), ["a", "b", "c"]);
assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]); ok("calls never overlap, and keep their order");

await assert.rejects(run({ run: async () => { throw new WebAssembly.RuntimeError("memory access out of bounds"); } }, {}), /out of bounds/);
assert.match(ortBroken(), /out of bounds/); ok("a trap marks the runtime as stopped");

let called = false;
await assert.rejects(run({ run: async () => { called = true; } }, {}), /ONNX Runtime stopped/);
assert.equal(called, false); ok("after a trap, calls fail fast without entering the runtime");

const { getDetector, getSegmenter, getFallbackDetector } = await import("../extension/engine/cv.js");
assert.equal(await getSegmenter(), null); ok("after a trap, no bubble model is handed out");
assert.equal(getDetector(), getFallbackDetector()); ok("after a trap, the text detector comes from the OpenCV fallback");
console.log(`ORT TRAP TESTS PASSED (${passed})`);
process.exit(0);
