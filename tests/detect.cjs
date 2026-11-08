const { createCanvas, loadImage } = require("canvas");
const fs = require("fs");
new Function(fs.readFileSync("../extension/bubble.js", "utf8"))();
const G = globalThis.GyT;

(async () => {
  for (const [name, file] of process.argv.slice(2).map((f, i) => ["page" + (i + 1), f])) {
    const img = await loadImage(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
    const c = createCanvas(W, H); const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H);
    const t0 = Date.now();
    const cands = G.detectBubbles(px);
    const ms = Date.now() - t0;
    console.log(`${name}: ${W}x${H}, ${cands.length} candidates in ${ms}ms`);
    // stamp marks like the background does, and estimate letter sizes
    const r = Math.max(9, Math.round(W / 70));
    ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    cands.forEach((cd, i) => {
      const inset = { x: cd.bbox.x + cd.bbox.w * 0.1, y: cd.bbox.y + cd.bbox.h * 0.1, w: cd.bbox.w * 0.8, h: cd.bbox.h * 0.8 };
      const kx = cd.scale, ky = cd.scale;
      const inside = (x, y) => { const bx = Math.floor((x - cd.bbox.x) / kx), by = Math.floor((y - cd.bbox.y) / ky); const bw = cd.cols.length / 2, bh = cd.rows.length / 2; if (bx < 0 || by < 0 || bx >= bw || by >= bh) return false; return cd.rows[by*2] >= 0 && bx >= cd.rows[by*2] && bx <= cd.rows[by*2+1] && cd.cols[bx*2] >= 0 && by >= cd.cols[bx*2] && by <= cd.cols[bx*2+1]; };
      const letter = G.estimateLetterSize(px, inset, inside);
      console.log(`  #${i + 1} bbox=${JSON.stringify(cd.bbox)} fill=${cd.fillRatio.toFixed(2)} std=${cd.lumStd.toFixed(1)} color=${cd.color} letter≈${letter && letter.toFixed(1)}px (base ${(W/42).toFixed(1)})`);
      ctx.strokeStyle = "#16a34a"; ctx.lineWidth = 2; ctx.strokeRect(cd.bbox.x, cd.bbox.y, cd.bbox.w, cd.bbox.h);
      const cx = cd.bbox.x + r + 1, cy = cd.bbox.y + r + 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = "#e11d48"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(String(i + 1), cx, cy + r * 0.05);
    });
    fs.writeFileSync(`${name}-marks.png`, c.toBuffer("image/png"));
  }
})();
