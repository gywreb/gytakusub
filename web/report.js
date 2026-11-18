// Gytakusub Web – the debug report: one .zip with, per translated page, the original image, the
// report JSON (Claude's answer, the regions, the placements, the timings) and a debug render (the
// erased page with the regions boxed and the translations drawn). The same files as the
// extension's "Export debug report" (extension/content.js), so the replay and audit tools read both.
import { VERSION } from "./version.js";

/**
 * @param {Array<object>} pages the app's pages that are translated (`result` set)
 * @param {object} settings the app's settings (the API key is never written)
 * @returns {Promise<{file: File, pages: number}>}
 */
export async function buildReport(pages, settings) {
  const files = [];
  const when = new Date().toISOString();
  const summary = { gytakusub: VERSION, app: "web", when, page: location.href, userAgent: navigator.userAgent, pages: [] };
  let n = 0;
  for (const page of pages) {
    const res = page.result, id = String(++n).padStart(2, "0");
    const canvas = page.el.querySelector("canvas.translated");
    const rep = {
      gytakusub: VERSION, app: "web", when, page: page.mode === "chapter" ? location.href : "screenshot", image: page.url || page.file?.name || "",
      natural: [res.width, res.height], displayed: canvas ? [Math.round(canvas.clientWidth), Math.round(canvas.clientHeight)] : null,
      work: res.work, letter: res.letter, fromCache: false, timing: res.timing || null, engine: res.engine || null,
      overlay: { dpr: window.devicePixelRatio || 1, backing: canvas ? [canvas.width, canvas.height] : null },
      settings: { model: settings.model, targetLang: settings.targetLang, fontFamily: settings.fontFamily, uppercase: settings.uppercase, useContext: settings.useContext },
      lettering: page.look ? { lang: page.look.lang ?? null, hyphenation: !!page.look.hyphenator } : null,
      regions: res.regions, items: res.items, placements: res.placements,
    };
    try { files.push({ name: `page-${id}.debug.png`, data: await debugRender(page, settings) }); }
    catch (err) { rep.debugRenderError = String(err?.message || err); }
    const original = page.file || page.blob;
    if (original) files.push({ name: `page-${id}.original.${extOf(original.type)}`, data: new Uint8Array(await original.arrayBuffer()) });
    else rep.originalError = "the page's image is no longer in memory";
    files.push({ name: `page-${id}.json`, data: new TextEncoder().encode(JSON.stringify(rep, null, 1)) });
    summary.pages.push({ id, image: rep.image, items: res.items.length, regions: res.regions.length });
  }
  files.unshift({ name: "summary.json", data: new TextEncoder().encode(JSON.stringify(summary, null, 1)) });
  const stamp = when.replace(/[:.]/g, "-").slice(0, 19);
  const file = new File([makeZip(files)], `gytakusub-report-web-${stamp}.zip`, { type: "application/zip" });
  return { file, pages: n };
}

const extOf = (type) => (/png/.test(type) ? "png" : /webp/.test(type) ? "webp" : /gif/.test(type) ? "gif" : "jpg");

/** The page at the engine's working size, erased (its patches), regions boxed, translations drawn. */
async function debugRender(page, settings) {
  const res = page.result, { W, H } = res.work;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.drawImage(page.img, 0, 0, W, H);
  ctx.setTransform(W / res.width, 0, 0, H / res.height, 0, 0);
  for (const p of res.patches || []) ctx.drawImage(p.bitmap, p.x, p.y, p.w, p.h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = Math.max(1, W / 600); ctx.font = `bold ${Math.max(10, W / 60)}px sans-serif`;
  for (const r of res.regions) {
    ctx.strokeStyle = r.kind === "bubble" ? "rgba(220,38,38,.9)" : "rgba(37,99,235,.9)";
    ctx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h);
    ctx.fillStyle = ctx.strokeStyle; ctx.fillText("#" + r.id, r.box.x + 3, r.box.y + W / 60);
  }
  for (const p of res.placements) { ctx.strokeStyle = "rgba(22,163,74,.9)"; ctx.strokeRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h); }
  globalThis.GyText.draw(ctx, res.placements, { fontFamily: settings.fontFamily, uppercase: settings.uppercase, lang: page.look?.lang ?? null, hyphenator: page.look?.hyphenator ?? null });
  const png = await new Promise((r) => c.toBlob(r, "image/png"));
  return new Uint8Array(await png.arrayBuffer());
}

// A minimal ZIP writer (stored, no compression), as in extension/content.js.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name]);
    parts.push(local, f.data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += local.length + size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const out = new Uint8Array(offset + cdSize + end.length);
  let p = 0;
  for (const a of [...parts, ...central, end]) { out.set(a, p); p += a.length; }
  return out;
}
