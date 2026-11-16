// One page at a time through the engine, most wanted first.
//
// The engine's models already run one call at a time (engine/ort.js), in the order they
// arrive. With three pages in progress their calls interleave, so the page on screen
// finished last. The lane gives the engine to one task at a time, and when it frees up it
// takes the waiting task with the lowest priority number (the worker passes the page's
// distance from the middle of the screen, which the content script keeps updating while
// you scroll). Equal priorities keep their arrival order.
//
// A long task (a page's analysis: several model runs) gets a `checkpoint` to await
// between its steps. There it hands the lane over if a more urgent task is waiting (the
// page you just stopped at, or the last step of a page on screen) and carries on when its
// turn comes back; there too it stops if it was cancelled. Nothing is lost by running
// tasks in turn: model calls were serial already, and the rest of the work is synchronous
// OpenCV code on the same thread.
//
// A task can also be `held`: it waits (and a running one pauses at its next checkpoint)
// while its `held()` says so. The worker holds pages that are off screen while a page on
// screen is in progress, because their model runs block the worker's one thread for
// seconds and the page on screen would wait for its own network reply in between. Call
// `wake()` when what `held()` depends on has changed.

/** The rejection of a task cancelled before it started or at a checkpoint. */
export class Cancelled extends Error {
  constructor() { super("cancelled"); this.name = "Cancelled"; }
}

/**
 * @returns {{
 *   run: <T>(fn: (checkpoint: () => Promise<void>) => Promise<T>|T, priority?: () => number, signal?: AbortSignal, held?: () => boolean) => Promise<T>,
 *   wake: () => void,
 *   readonly size: number,
 * }}
 */
export function createLane() {
  const waiting = []; // { task, go }
  let holder = null, seq = 0;

  const rank = (task) => { const p = Number(task.priority()); return Number.isFinite(p) ? p : Infinity; };
  const before = (a, b) => { const d = rank(a) - rank(b); return d < 0 || (d === 0 && a.seq < b.seq); };

  const isHeld = (task) => { try { return !!task.held(); } catch { return false; } };

  function next() {
    if (holder) return;
    let best = -1;
    for (let i = 0; i < waiting.length; i++) {
      if (isHeld(waiting[i].task)) continue;
      if (best < 0 || before(waiting[i].task, waiting[best].task)) best = i;
    }
    if (best < 0) return;
    const w = waiting.splice(best, 1)[0];
    holder = w.task;
    w.go();
  }

  /** Waits until `task` holds the lane; rejects with Cancelled if its signal aborts first. */
  function acquire(task) {
    return new Promise((resolve, reject) => {
      if (task.signal?.aborted) { reject(new Cancelled()); return; }
      const onAbort = () => {
        const i = waiting.indexOf(w);
        if (i >= 0) { waiting.splice(i, 1); reject(new Cancelled()); }
      };
      const w = { task, go: () => { task.signal?.removeEventListener("abort", onAbort); resolve(); } };
      task.signal?.addEventListener("abort", onAbort, { once: true });
      waiting.push(w);
      next();
    });
  }

  function release(task) {
    if (holder !== task) return;
    holder = null;
    next();
  }

  return {
    /**
     * Runs `fn` when the lane is free and no waiting task has a lower priority number.
     * @param fn the work; gets a `checkpoint()` to await between steps. Its result or error is passed on.
     * @param priority read whenever the lane chooses, so it can change while the task waits (lower runs sooner)
     * @param signal abort to cancel: a waiting task is dropped, a running one stops at its next checkpoint
     * @param held while it returns true the task does not start, and a running one pauses at its next checkpoint
     */
    async run(fn, priority = () => 0, signal = undefined, held = () => false) {
      const task = { priority, signal, held, seq: seq++ };
      await acquire(task);
      const checkpoint = async () => {
        if (signal?.aborted) throw new Cancelled();
        if (!isHeld(task) && !waiting.some((w) => !isHeld(w.task) && before(w.task, task))) return;
        release(task); // held, or someone more urgent is waiting: they go first
        await acquire(task);
        if (signal?.aborted) throw new Cancelled();
      };
      try { return await fn(checkpoint); }
      finally { release(task); }
    },
    /** Re-check held tasks (call when what their `held()` reads has changed). */
    wake() { next(); },
    /** Tasks waiting or running. */
    get size() { return waiting.length + (holder ? 1 : 0); },
  };
}
