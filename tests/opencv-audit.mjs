// What OpenCV objects the engine leaves alive, and the engine made to fail inside OpenCV.
//
// OpenCV.js keeps every object it hands out (a Mat, a view of one, a vector) in its own memory
// until the object is deleted. This wraps the `cv` the tests share so that every such object is
// recorded with the engine line that made it, and forgotten when deleted: `alive()` is then exactly
// what nobody freed. Every OpenCV call also counts against the engine line that made it, and
// `failAt(site)` makes the first call from that line throw the way OpenCV does (a bare number),
// so each line can be made to fail once and the engine's cleanup on that path checked.
// Nothing here changes what the engine computes: the wrappers pass every call through.

const ENGINE = "/extension/engine/";
// the engine line a call came from: the first frame in an engine file
function siteOf(stack) {
  for (const line of stack.split("\n").slice(2)) {
    const i = line.indexOf(ENGINE);
    if (i >= 0) return line.slice(i + ENGINE.length).replace(/:\d+\)?$/, "").replace(/\)$/, "");
  }
  return null;
}
const isHandle = (v) => v && typeof v === "object" && typeof v.isDeleted === "function" && typeof v.delete === "function";

export function audit(cv) {
  const live = new Map(); // object → the engine line that made it
  const sites = new Map(); // engine line → OpenCV calls made from it
  let failing = null, failed = false;
  const THROWN = 6686152; // what OpenCV throws: the address of its C++ exception
  const note = (obj, stack) => { if (isHandle(obj) && !obj.isDeleted()) live.set(obj, siteOf(stack) || "(outside the engine)"); return obj; };
  const enter = (stack) => {
    const site = siteOf(stack);
    if (!site) return;
    sites.set(site, (sites.get(site) || 0) + 1);
    if (failing === site && !failed) { failed = true; throw THROWN; }
  };
  const wrapFn = (fn) => {
    const w = function (...args) {
      const stack = new Error().stack;
      enter(stack);
      const out = fn.apply(this, args);
      return note(out, stack);
    };
    // an overloaded function finds its overloads on itself (embind's overloadTable): they come along
    for (const p of Object.getOwnPropertyNames(fn)) if (!["length", "name", "prototype", "arguments", "caller"].includes(p)) w[p] = fn[p];
    return w;
  };
  // the module's functions (cvtColor, threshold, matFromImageData…), not its classes or internals
  for (const k of Object.keys(cv)) {
    const v = cv[k];
    if (typeof v !== "function" || !/^[a-z]/.test(k) || k === "then" || typeof v.prototype?.isDeleted === "function") continue; // (a class: dnn_Net)
    cv[k] = wrapFn(v);
  }
  // the methods of every class OpenCV hands objects of (a Mat's view and copy, a vector's element,
  // a network's output…), and the two classes the engine makes with `new` and by their own static
  // functions (Mat.zeros…)
  const SKIP = ["constructor", "delete", "isDeleted", "deleteLater", "isAliasOf", "clone_"];
  for (const name of Object.keys(cv)) {
    const C = cv[name];
    if (typeof C !== "function" || typeof C.prototype?.isDeleted !== "function") continue; // (dnn_Net among them)
    const proto = C.prototype;
    for (const k of Object.getOwnPropertyNames(proto)) {
      const d = Object.getOwnPropertyDescriptor(proto, k);
      if (d && typeof d.value === "function" && !SKIP.includes(k)) proto[k] = wrapFn(d.value);
    }
  }
  for (const name of ["Mat", "MatVector"]) {
    cv[name] = new Proxy(cv[name], {
      construct(target, args) { const stack = new Error().stack; enter(stack); return note(Reflect.construct(target, args), stack); },
      get(target, key, recv) {
        const v = Reflect.get(target, key, recv);
        return typeof v === "function" && key !== "prototype" && /^[a-z]/.test(String(key)) ? wrapFn(v) : v;
      },
    });
  }
  // every object's delete (shared by all of OpenCV's classes)
  const base = Object.getPrototypeOf(cv.Mat.prototype), del = base.delete;
  base.delete = function () { live.delete(this); return del.call(this); };

  return {
    /** Objects alive now, by the engine line that made them: {line: count}. */
    alive() { const by = {}; for (const [o, s] of live) { if (o.isDeleted()) { live.delete(o); continue; } by[s] = (by[s] || 0) + 1; } return by; },
    /** Forget what is alive now (objects that are meant to stay: models, caches). */
    settle() { live.clear(); },
    /** The engine lines that called OpenCV since the last reset, with how often. */
    sites: () => new Map(sites),
    reset() { sites.clear(); },
    /** Make the next call from `site` throw as OpenCV does (null: none). Whether it did: failed(). */
    failAt(site) { failing = site; failed = false; },
    failed: () => failed,
    THROWN,
  };
}
