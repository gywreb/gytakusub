// Eraser regression: glyph-sized ink over a halftone background must be erased,
// while adjacent LINE ART (long strokes) and a bubble OUTLINE must survive, and
// the model's box being too small must not leave glyphs standing.
import { createCanvas } from "canvas";
import fs from "node:fs";
import assert from "node:assert/strict";
new Function(fs.readFileSync("../web/bubble.js", "utf8"))();
const G = globalThis.GyT;
globalThis.document = { createElement() { return createCanvas(1, 1); } };

const W = 600, H = 300, L = 24;
const c = createCanvas(W, H); const x = c.getContext("2d");
x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
x.fillStyle = "#888"; for (let yy = 0; yy < H; yy += 8) for (let xx = (yy / 8) % 2 ? 4 : 0; xx < W; xx += 8) x.fillRect(xx, yy, 3, 3); // halftone sky
// line art: a long diagonal stroke and a figure outline
x.strokeStyle = "#000"; x.lineWidth = 4; x.beginPath(); x.moveTo(40, 280); x.lineTo(560, 40); x.stroke();
x.beginPath(); x.ellipse(480, 200, 60, 80, 0, 0, Math.PI * 2); x.stroke();
// "glyphs": two lines of small letter-like blobs, wider than the model box we'll give
x.fillStyle = "#000"; x.font = `bold ${L}px sans-serif`;
x.fillText("ESPEREN... Y TAMBIEN", 60, 100); x.fillText("TOKIME, RENTARO", 60, 140);
const px = x.getImageData(0, 0, W, H);
const before = Buffer.from(px.data);

// overlay ctx (transparent)
const ov = createCanvas(W, H); const octx = ov.getContext("2d");
const core = { x: 120, y: 80, w: 140, h: 60 }; // deliberately too small: covers only part of the lettering
const r = G.eraseTextZone(octx, px, core, { letter: L });
assert.ok(r, "eraser should act on glyph-sized ink");
console.log("erased rect", r.rect);
assert.ok(r.rect.x <= 62 && r.rect.x + r.rect.w >= 300, "erase extent grew to the full lettering: " + JSON.stringify(r.rect));

// composite and inspect
const out = createCanvas(W, H); const o = out.getContext("2d"); o.drawImage(c, 0, 0); o.drawImage(ov, 0, 0);
const after = o.getImageData(0, 0, W, H).data;
const dark = (d, i) => d[i] < 110;
// 1. glyph pixels inside the lettering are gone (sample a stripe through line 1)
let glyphLeft = 0; for (let xx = 60; xx < 330; xx++) { const i = (90 * W + xx) * 4; if (dark(after, i)) glyphLeft++; }
console.log("dark px left on text line:", glyphLeft);
assert.ok(glyphLeft < 6, "lettering should be erased");
// 2. the long stroke survives where it crosses the zone (sample points along the line inside x 60..330)
let strokeKept = 0, strokeTotal = 0;
const band = (d, xx, yy) => { for (let k = -2; k <= 2; k++) if (dark(d, ((yy + k) * W + xx) * 4)) return true; return false; };
for (let xx = 100; xx < 330; xx += 3) { const yy = Math.round(280 - (xx - 40) * (240 / 520)); if (band(before, xx, yy)) { strokeTotal++; if (band(after, xx, yy)) strokeKept++; } }
console.log(`stroke kept ${strokeKept}/${strokeTotal}`);
fs.writeFileSync("/tmp/eraser.png", out.toBuffer("image/png"));
assert.ok(strokeKept >= strokeTotal * 0.97, "line art must survive the eraser");
// 3. nothing painted far from the glyphs (ellipse outline untouched)
let ellKept = 0, ellTotal = 0; for (let a = 0; a < Math.PI * 2; a += 0.1) { const xx = Math.round(480 + 60 * Math.cos(a)), yy = Math.round(200 + 80 * Math.sin(a)); const i = (yy * W + xx) * 4; if (dark(before, i)) { ellTotal++; if (dark(after, i)) ellKept++; } }
assert.equal(ellKept, ellTotal, "outline untouched");
fs.writeFileSync("/tmp/eraser.png", out.toBuffer("image/png"));
console.log("ERASER TEST PASSED");
