// Gytakusub Web – the page engine (OpenCV analysis, erase, layout) runs here,
// off the main thread. Same engine modules as the extension's service worker.
import { preparePage, finishPage } from "./engine/page.js";

const jobs = new Map();
let seq = 0;

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === "prepare") {
      const job = await preparePage(e.data.bitmap, e.data.settings);
      e.data.bitmap.close();
      const jobId = ++seq;
      jobs.set(jobId, job);
      const slices = job.slices.map((s) => ({ b64: s.b64, mediaType: s.mediaType, cw: s.cw, ch: s.ch, tagFrom: s.tagFrom, tagTo: s.tagTo, x: s.x, y: s.y, w: s.w, h: s.h }));
      self.postMessage({ id, ok: true, jobId, slices, width: job.width, height: job.height, work: job.work });
    } else if (type === "finish") {
      const job = jobs.get(e.data.jobId); jobs.delete(e.data.jobId);
      if (!job) throw new Error("Page analysis expired; translate again.");
      const page = await finishPage(job, e.data.results);
      const clean = page.canvas.transferToImageBitmap();
      self.postMessage({ id, ok: true, items: page.items, placements: page.placements, regions: page.regions, work: page.work, letter: page.letter, clean }, [clean]);
    } else if (type === "drop") {
      const job = jobs.get(e.data.jobId); jobs.delete(e.data.jobId);
      if (job) for (const s of job.slices) s.analysis.dispose();
      self.postMessage({ id, ok: true });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
