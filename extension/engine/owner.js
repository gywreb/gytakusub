// Frees what a piece of engine work made in OpenCV, on every way out of it.
//
// OpenCV.js keeps each object it hands out (a Mat, a view of one, a vector of them) in its own
// memory until the object is deleted. That memory is capped (1 GiB) and is not given back while
// the worker lives. Deleting each object by hand where its work is done skips the deletes whenever
// something in between throws: a page stopped at a checkpoint (the prefill stops so whenever the
// answer comes first), a model that fails, OpenCV itself. So each function that makes OpenCV
// objects makes an owner, passes each object through it as it is made, and frees the owner when it
// returns or throws; an object it hands back to its caller it lets go of (`own.keep`), and the
// caller's owner takes it on.
//
//   return owning((own) => { const m = own(new cv.Mat()); …; return own.keep(result); });
//
// Deleting an object early, to keep the peak low, is still fine: freeing skips what is deleted.

/** @returns {((obj: T) => T) & {keep: (obj: T) => T, free: () => void}} */
export function owner() {
  const held = new Set();
  const own = (obj) => { if (obj) held.add(obj); return obj; };
  own.keep = (obj) => { held.delete(obj); return obj; };
  own.free = () => { for (const o of held) if (!o.isDeleted()) o.delete(); held.clear(); };
  return own;
}

/** `work(own)` with an owner that is freed when the work returns, throws, or (async) settles. */
export function owning(work) {
  const own = owner();
  let out;
  try { out = work(own); } catch (e) { own.free(); throw e; }
  if (out && typeof out.then === "function") return out.finally(own.free);
  own.free();
  return out;
}
