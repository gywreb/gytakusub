// Gytakusub Web – the page engine (OpenCV analysis, erase, layout) runs here,
// off the main thread. Same engine modules as the extension's service worker.
import { preparePage, prefillPage, finishPage } from "./engine/page.js";

const jobs = new Map();
let seq = 0;
// pages being analysed or finished: a prefill only uses time when there are none (it waits at its
// next area), so it never delays another page — the same rule as the extension's lane
let busy = 0;

self.onmessage = async (e) => {
  const { id, type } = e.data;
  const work = type === "prepare" || type === "finish";
  if (work) busy++;
  try {
    if (type === "prepare") {
      const job = await preparePage(e.data.bitmap, e.data.settings);
      e.data.bitmap.close();
      const jobId = ++seq;
      jobs.set(jobId, job);
      const slices = job.slices.map((s) => ({ b64: s.b64, mediaType: s.mediaType, cw: s.cw, ch: s.ch, tagFrom: s.tagFrom, tagTo: s.tagTo, x: s.x, y: s.y, w: s.w, h: s.h }));
      self.postMessage({ id, ok: true, jobId, slices, width: job.width, height: job.height, work: job.work });
    } else if (type === "prefill") {
      // while Claude answers: fill the page's textured areas ahead (engine/page.js prefillPage),
      // until the finish (or a drop) says stop. `natural`: the page at its own size, kept for the finish.
      const job = jobs.get(e.data.jobId);
      if (!job) { e.data.natural?.close(); self.postMessage({ id, ok: true }); return; }
      job.natural = e.data.natural || null;
      job.stop = false;
      const checkpoint = async () => {
        while (busy && !job.stop) await new Promise((r) => setTimeout(r, 25));
        if (job.stop) throw new Error("stopped");
      };
      job.prefilling = prefillPage(job, { natural: job.natural, checkpoint }).catch(() => {});
      await job.prefilling;
      self.postMessage({ id, ok: true });
    } else if (type === "finish") {
      const job = jobs.get(e.data.jobId); jobs.delete(e.data.jobId);
      if (!job) throw new Error("Page analysis expired; translate again.");
      await stopPrefill(job);
      // the page at its own size again (when it was downscaled for the analysis): the erased
      // areas come back at full resolution, as patches over the original
      const natural = e.data.natural || job.natural || null;
      let page;
      try { page = await finishPage(job, e.data.results, { natural }); } finally { natural?.close(); }
      const patches = page.patches.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, bitmap: p.canvas.transferToImageBitmap() }));
      // (and what the debug report records: which engine, where the models ran, their times, how the areas were filled)
      self.postMessage({ id, ok: true, items: page.items, placements: page.placements, regions: page.regions, work: page.work, letter: page.letter, patches, engine: page.engine, backend: page.backend, detectMs: page.detectMs, segmentMs: page.segmentMs, fill: page.fill }, patches.map((p) => p.bitmap));
    } else if (type === "drop") {
      const job = jobs.get(e.data.jobId); jobs.delete(e.data.jobId);
      if (job) { await stopPrefill(job); for (const s of job.slices) s.analysis.dispose(); job.natural?.close(); }
      self.postMessage({ id, ok: true });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  } finally { if (work) busy--; }
};

/** Stops a page's prefill at its next area and waits for it (before its analyses are used or freed). */
async function stopPrefill(job) {
  job.stop = true;
  await job.prefilling;
}
