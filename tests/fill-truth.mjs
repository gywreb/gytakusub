// The eraser's fill against known backgrounds (2.12.0): stretches of real pages with no lettering
// get lettering drawn on them, the eraser fills it, and the fill is compared with what was there.
// Same mask for every method (the drawn lettering and its outline, grown as the eraser grows its
// mask), so this measures the fill alone.
//   node fill-truth.mjs <report.zip>... --out dir [--aot inpaint.onnx] [--per-page 3]
// Reports stay local (they hold the pages); the numbers go in ADR 0013.
//  - 2.11: Telea, as 2.11 filled every area
//  - 2.12: fillArea: the flat colour where the surface is flat, the screentone fill where it is a
//    lattice, the learned inpainter otherwise (Telea without one)
// Per area: mean absolute error on the filled pixels, SSIM over the lettering's box (7 px windows
// centred on filled pixels), and texture kept (mean gradient of the fill over the truth's: 1 is
// right, below 1 a cloud or a blur, above 1 noise).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage } from "canvas";
import { cv, analyzePage } from "./cv-node.mjs";
import { flatSurface, fillArea } from "../extension/engine/erase.js";
import { getOrt, createSession, run } from "../extension/engine/ort.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const zips = process.argv.slice(2).filter((a, i, all) => a.endsWith(".zip") && !String(all[i - 1]).startsWith("--"));
const out = arg("--out", "/tmp/gyt-fill-truth"), perPage = Number(arg("--per-page", 3));
const aotFile = arg("--aot", "../extension/vendor/inpaint.onnx");
fs.mkdirSync(out, { recursive: true });
const model = fs.existsSync(aotFile) ? { ort: getOrt(), session: (await createSession(new Uint8Array(fs.readFileSync(aotFile)), { gpu: false })).session, run } : null;

const WORDS = ["WAIT", "WHAT IS THIS", "NO WAY", "RUN!", "I KNEW IT", "MEANWHILE", "THAT NIGHT", "STOP", "HEY YOU", "IT'S OVER", "BEHIND YOU", "NOT YET"];
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const PW = 240, PH = 160;
const lumOf = (d, i, ch) => (ch === 4 ? (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3 : (d[i * 3] + d[i * 3 + 1] + d[i * 3 + 2]) / 3);

const rows = [];
for (const zip of zips) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-truth-"));
  execFileSync("unzip", ["-oq", zip, "-d", tmp]);
  const summary = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8"));
  const name = path.basename(zip, ".zip").slice(-19);
  for (const pg of summary.pages) {
    const rep = JSON.parse(fs.readFileSync(path.join(tmp, `page-${pg.id}.json`), "utf8"));
    const orig = fs.readdirSync(tmp).find((f) => f.startsWith(`page-${pg.id}.original.`));
    if (!orig || !rep.work) continue;
    const { W, H } = rep.work;
    const img = await loadImage(path.join(tmp, orig));
    const c = createCanvas(W, H), x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0, W, H);
    const page = x.getImageData(0, 0, W, H);
    const an = await analyzePage(new ImageData(new Uint8ClampedArray(page.data), W, H));
    // stretches with no lettering found on them (every region grown by two letters), not plain
    const busy = (px, py) => an.regions.some((r) => { const m = 2 * (r.letter || 10); return px < r.box.x + r.box.w + m && px + PW > r.box.x - m && py < r.box.y + r.box.h + m && py + PH > r.box.y - m; });
    const spots = [];
    for (let py = 8; py + PH < H - 8; py += 120) for (let px = 8; px + PW < W - 8; px += 120) if (!busy(px, py)) spots.push([px, py]);
    an.dispose();
    let taken = 0;
    for (const [px, py] of spots.sort(() => rnd() - 0.5)) {
      if (taken >= perPage) break;
      const clean = x.getImageData(px, py, PW, PH);
      const rgbT = rgbMat(clean), none = cv.Mat.zeros(PH, PW, cv.CV_8UC1);
      const flat = flatSurface(rgbT, none, null);
      none.delete(); rgbT.delete();
      if (flat) continue; // flat: every method fills it with its colour (the white-bubble case)
      // lettering: outlined (white stroke, black fill) or plain black, as narration and dialogue
      const t = createCanvas(PW, PH), tx = t.getContext("2d");
      tx.putImageData(clean, 0, 0);
      const size = 20 + Math.round(rnd() * 14), outlined = rnd() < 0.5;
      tx.font = `bold ${size}px sans-serif`; tx.textAlign = "center"; tx.textBaseline = "middle";
      const word = WORDS[Math.floor(rnd() * WORDS.length)];
      if (outlined) { tx.lineJoin = "round"; tx.lineWidth = Math.round(size / 5); tx.strokeStyle = "#fff"; tx.strokeText(word, PW / 2, PH / 2); }
      tx.fillStyle = "#000"; tx.fillText(word, PW / 2, PH / 2);
      const lettered = tx.getImageData(0, 0, PW, PH);
      const mask = new cv.Mat(PH, PW, cv.CV_8UC1);
      for (let i = 0; i < PW * PH; i++) mask.data[i] = Math.abs(lumOf(lettered.data, i, 4) - lumOf(clean.data, i, 4)) > 10 ? 255 : 0;
      // grown over the anti-aliased fringe as the eraser grows its mask (erase.js: 0.15 of a letter)
      const g = Math.max(2, Math.round(size * 0.15)), k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * g + 1, 2 * g + 1)); cv.dilate(mask, mask, k); k.delete();
      const holeN = cv.countNonZero(mask);
      if (holeN < 200) { mask.delete(); continue; }
      const rgb = rgbMat(lettered);
      const res = {};
      let t0 = Date.now();
      const telea = new cv.Mat(); cv.inpaint(rgb, mask, telea, Math.max(3, Math.round(size * 0.3)), cv.INPAINT_TELEA);
      res["2.11"] = { mat: telea, ms: Date.now() - t0, kind: "telea" };
      t0 = Date.now();
      const f = await fillArea(cv, model, rgb, mask, null);
      let m12 = f.mat; if (!m12) { m12 = new cv.Mat(); cv.inpaint(rgb, mask, m12, Math.max(3, Math.round(size * 0.3)), cv.INPAINT_TELEA); }
      res["2.12"] = { mat: m12, ms: Date.now() - t0, kind: f.kind };
      const row = { chapter: name, page: pg.id, at: [px, py], outlined, size, hole: holeN };
      for (const [v, r] of Object.entries(res)) { row[v] = { kind: r.kind, ms: r.ms, ...score(clean.data, r.mat.data, mask.data) }; }
      rows.push(row);
      if (rows.length <= 400) save(path.join(out, `${name}-p${pg.id}-${px}-${py}.png`), [clean.data, lettered.data, res["2.11"].mat.data, res["2.12"].mat.data]);
      for (const r of Object.values(res)) r.mat.delete();
      rgb.delete(); mask.delete();
      taken++;
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error(`${name}: ${rows.filter((r) => r.chapter === name).length} areas`);
}
fs.writeFileSync(path.join(out, "fill-truth.json"), JSON.stringify(rows, null, 1));

// summary: per method, and per 2.12 fill kind
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sum = (sel) => ({ n: sel.length, mae: +mean(sel.map((r) => r.mae)).toFixed(1), ssim: +mean(sel.map((r) => r.ssim)).toFixed(3), texture: +mean(sel.map((r) => r.texture)).toFixed(2), ms: Math.round(mean(sel.map((r) => r.ms))) });
const report = { areas: rows.length, "2.11": sum(rows.map((r) => r["2.11"])), "2.12": sum(rows.map((r) => r["2.12"])), byKind: {} };
for (const kind of ["tone", "learned", "telea"]) {
  const sel = rows.filter((r) => r["2.12"].kind === kind);
  if (sel.length) report.byKind[kind] = { "2.11": sum(sel.map((r) => r["2.11"])), "2.12": sum(sel.map((r) => r["2.12"])) };
}
report.better = rows.filter((r) => r["2.12"].mae < r["2.11"].mae).length;
console.log(JSON.stringify(report, null, 1));

function rgbMat(id) { const m = cv.matFromImageData(id), o = new cv.Mat(); cv.cvtColor(m, o, cv.COLOR_RGBA2RGB); m.delete(); return o; }

function score(truth, got, mask) {
  const L = (i) => lumOf(truth, i, 4), G = (i) => lumOf(got, i, 3);
  let err = 0, n = 0, gT = 0, gG = 0, x0 = PW, y0 = PH, x1 = 0, y1 = 0;
  for (let yy = 1; yy < PH - 1; yy++) for (let xx = 1; xx < PW - 1; xx++) {
    const i = yy * PW + xx; if (!mask[i]) continue;
    err += Math.abs(G(i) - L(i)); n++;
    gT += Math.abs(L(i + 1) - L(i - 1)) + Math.abs(L(i + PW) - L(i - PW));
    gG += Math.abs(G(i + 1) - G(i - 1)) + Math.abs(G(i + PW) - G(i - PW));
    if (xx < x0) x0 = xx; if (yy < y0) y0 = yy; if (xx > x1) x1 = xx; if (yy > y1) y1 = yy;
  }
  // SSIM (luminance, 7 × 7 windows, the usual constants) at filled pixels
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, r = 3;
  let ss = 0, sn = 0;
  for (let yy = Math.max(r, y0); yy <= Math.min(PH - 1 - r, y1); yy += 2) for (let xx = Math.max(r, x0); xx <= Math.min(PW - 1 - r, x1); xx += 2) {
    if (!mask[yy * PW + xx]) continue;
    let ma = 0, mb = 0, va = 0, vb = 0, cov = 0, k = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = (yy + dy) * PW + xx + dx; ma += L(i); mb += G(i); k++; }
    ma /= k; mb /= k;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = (yy + dy) * PW + xx + dx; const a = L(i) - ma, b = G(i) - mb; va += a * a; vb += b * b; cov += a * b; }
    va /= k - 1; vb /= k - 1; cov /= k - 1;
    ss += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); sn++;
  }
  return { mae: err / Math.max(1, n), ssim: ss / Math.max(1, sn), texture: gT > 0 ? gG / gT : 1 };
}

function save(file, datas) {
  const s = createCanvas(PW * datas.length + 6 * (datas.length - 1), PH), sx = s.getContext("2d");
  sx.fillStyle = "#f0f"; sx.fillRect(0, 0, s.width, PH);
  datas.forEach((d, i) => {
    const id = sx.createImageData(PW, PH);
    if (d.length === PW * PH * 4) id.data.set(d); else for (let j = 0; j < PW * PH; j++) { id.data[j * 4] = d[j * 3]; id.data[j * 4 + 1] = d[j * 3 + 1]; id.data[j * 4 + 2] = d[j * 3 + 2]; id.data[j * 4 + 3] = 255; }
    sx.putImageData(id, i * (PW + 6), 0);
  });
  fs.writeFileSync(file, s.toBuffer("image/png"));
}
