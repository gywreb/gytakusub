// The worker's page lane (extension/lane.js): one task at a time, lowest priority number
// first, ties in arrival order, priorities read live, cancellation only while waiting.
import assert from "node:assert/strict";
import { createLane, Cancelled } from "../extension/lane.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. one at a time
{
  const lane = createLane();
  let inside = 0, most = 0;
  const work = () => lane.run(async () => { inside++; most = Math.max(most, inside); await sleep(5); inside--; });
  await Promise.all([work(), work(), work(), work()]);
  ok(most === 1, `tasks overlapped (${most} at once)`);
  ok(lane.size === 0, "lane not empty after all tasks finished");
}

// 2. lowest priority first once the lane frees up; ties keep arrival order
{
  const lane = createLane();
  const order = [];
  const first = lane.run(() => sleep(10).then(() => order.push("busy")));
  const p = (name, prio) => lane.run(() => { order.push(name); }, () => prio);
  await Promise.all([first, p("far", 3000), p("near", 50), p("tieA", 400), p("tieB", 400), p("onScreen", 0)]);
  assert.deepEqual(order, ["busy", "onScreen", "near", "tieA", "tieB", "far"]); checks++;
}

// 3. priorities are read when the lane picks, not when the task was added (the user scrolled)
{
  const lane = createLane();
  const order = [];
  const dist = { a: 10, b: 900 };
  const busy = lane.run(() => sleep(10));
  const a = lane.run(() => order.push("a"), () => dist.a);
  const b = lane.run(() => order.push("b"), () => dist.b);
  dist.a = 5000; dist.b = 0; // scrolled down: b is on screen now, a far behind
  await Promise.all([busy, a, b]);
  assert.deepEqual(order, ["b", "a"]); checks++;
}

// 4. cancelling a waiting task drops it; the started one finishes; a missing or bad priority goes last
{
  const lane = createLane();
  const order = [];
  const ctl = new AbortController(), started = new AbortController();
  const busy = lane.run(async () => { await sleep(10); order.push("busy"); }, () => 0, started.signal);
  const dropped = lane.run(() => order.push("dropped"), () => 0, ctl.signal);
  const nan = lane.run(() => order.push("nan"), () => NaN);
  const kept = lane.run(() => order.push("kept"), () => 1);
  ctl.abort(); started.abort(); // the running task ignores its abort
  await assert.rejects(dropped, (e) => e instanceof Cancelled); checks++;
  await Promise.all([busy, nan, kept]);
  assert.deepEqual(order, ["busy", "kept", "nan"]); checks++;
  await assert.rejects(lane.run(() => 1, () => 0, ctl.signal), (e) => e instanceof Cancelled, "an already aborted signal must not run"); checks++;
}

// 5. a failing task passes its error on and does not block the lane
{
  const lane = createLane();
  await assert.rejects(lane.run(() => { throw new Error("boom"); }), /boom/); checks++;
  ok(await lane.run(() => 42) === 42, "lane stuck after a failed task");
}

// 6. a long task hands the lane over at a checkpoint when something more urgent waits, then resumes
{
  const lane = createLane();
  const order = [];
  const far = lane.run(async (checkpoint) => {
    order.push("far:step1"); await sleep(10);
    await checkpoint(); // the page on screen arrived meanwhile
    order.push("far:step2");
    await checkpoint(); // nothing more urgent now: carries straight on
    order.push("far:step3");
  }, () => 900);
  await sleep(2);
  const near = lane.run(() => { order.push("near"); }, () => 0);
  const later = lane.run(() => { order.push("later"); }, () => 5000); // less urgent: waits for far
  await Promise.all([far, near, later]);
  assert.deepEqual(order, ["far:step1", "near", "far:step2", "far:step3", "later"]); checks++;
}

// 7. a running task that was cancelled stops at its next checkpoint and frees the lane
{
  const lane = createLane();
  const ctl = new AbortController();
  let reached = false;
  const t = lane.run(async (checkpoint) => { await sleep(5); ctl.abort(); await checkpoint(); reached = true; }, () => 0, ctl.signal);
  await assert.rejects(t, (e) => e instanceof Cancelled); checks++;
  ok(!reached, "the cancelled task went past its checkpoint");
  ok(await lane.run(() => "free") === "free" && lane.size === 0, "the lane was not freed after a cancel");
}

// 8. held tasks wait (a page on screen is in progress elsewhere) and go on wake(); a running
//    one pauses at its checkpoint while held, and the lane stays free for unheld tasks
{
  const lane = createLane();
  const order = [];
  let onScreenBusy = false;
  const offScreen = () => onScreenBusy;
  const long = lane.run(async (checkpoint) => {
    order.push("off:step1"); await sleep(5);
    onScreenBusy = true; // the page you stopped at went to Claude
    await checkpoint(); // pauses here
    order.push("off:step2");
  }, () => 900, undefined, offScreen);
  const other = lane.run(() => { order.push("off2"); }, () => 1000, undefined, offScreen);
  await sleep(20);
  ok(order.join() === "off:step1", `held tasks ran: ${order.join()}`);
  await lane.run(() => { order.push("onScreen:finish"); }, () => 0); // not held: runs while the others wait
  onScreenBusy = false; lane.wake();
  await Promise.all([long, other]);
  assert.deepEqual(order, ["off:step1", "onScreen:finish", "off:step2", "off2"]); checks++;
}

console.log(`lane: ${checks} checks passed`);
