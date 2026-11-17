// Erased areas at the page's own size (2.11.0): the work-resolution mask, resampled onto the
// full-size pixels, removes the lettering there; nothing outside the mask changes; the mask lands
// where the lettering is (no shift); and a mask that misses the area returns null.
//   node fullsize.test.mjs
import assert from "node:assert/strict";
import { createCanvas } from "canvas";
import { cv } from "./cv-node.mjs";
import { eraseFullSize } from "../extension/engine/erase.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

// a full-size page: white with grey tone on the right half and bold lettering across both
const NW = 600, NH = 400, scale = 0.55;
const page = createCanvas(NW, NH), pctx = page.getContext("2d");
pctx.fillStyle = "#fff"; pctx.fillRect(0, 0, NW, NH);
pctx.fillStyle = "#c8c8c8"; pctx.fillRect(NW / 2, 0, NW / 2, NH);
pctx.fillStyle = "#000"; pctx.font = "bold 46px sans-serif"; pctx.fillText("HELLO THERE", 120, 210);
const natural = pctx.getImageData(0, 0, NW, NH);

// the work page and its mask: dark ink grown by two work pixels, as erase() leaves it
const WW = Math.round(NW * scale), WH = Math.round(NH * scale);
const work = createCanvas(WW, WH), wctx = work.getContext("2d"); wctx.drawImage(page, 0, 0, WW, WH);
const wsrc = cv.matFromImageData(wctx.getImageData(0, 0, WW, WH)), gray = new cv.Mat(), mask = new cv.Mat();
cv.cvtColor(wsrc, gray, cv.COLOR_RGBA2GRAY);
cv.threshold(gray, mask, 120, 255, cv.THRESH_BINARY_INV);
const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)); cv.dilate(mask, mask, k); k.delete();
wsrc.delete(); gray.delete();

const crop = (x, y, w, h) => { const c = createCanvas(w, h); c.getContext("2d").drawImage(page, x, y, w, h, 0, 0, w, h); return c.getContext("2d").getImageData(0, 0, w, h); };
const dark = (img) => { let n = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 90) n++; return n; };

const AX = 100, AY = 150, AW = 420, AH = 90;
const area = crop(AX, AY, AW, AH);
const out = await eraseFullSize(cv, area, AX, AY, mask, scale, 0, 0, { fill: "telea", radius: 3 });

test("returns an image the size of the full-size area", () => {
  assert.ok(out);
  assert.equal(out.width, AW); assert.equal(out.height, AH);
});
test("the lettering is gone at full size", () => {
  const before = dark(area), after = dark(out);
  assert.ok(before > 1500, `test page has lettering (${before})`);
  assert.ok(after < before * 0.01, `dark pixels left: ${after} of ${before}`);
});
test("pixels outside the mask are untouched", () => {
  // resample the mask the way eraseFullSize does and compare outside it
  const M = cv.matFromArray(2, 3, cv.CV_64F, [scale, 0, (AX + 0.5) * scale - 0.5, 0, scale, (AY + 0.5) * scale - 0.5]);
  const m = new cv.Mat(); cv.warpAffine(mask, m, M, new cv.Size(AW, AH), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0)); M.delete();
  let changed = 0;
  for (let p = 0; p < AW * AH; p++) if (m.data[p] === 0 && Math.abs(out.data[p * 4] - area.data[p * 4]) > 0) changed++;
  m.delete();
  assert.equal(changed, 0, `${changed} pixels changed outside the mask`);
});
test("the mask lands on the lettering (no shift): no letter pixel survives", () => {
  // a mask shifted by even one full-size pixel would leave the letters' edges on one side
  let left = 0;
  for (let p = 0; p < AW * AH * 4; p += 4) if (out.data[p] < 90 && area.data[p] < 90) left++;
  assert.equal(left, 0, `${left} letter pixels survived`);
});
test("tone keeps its level where letters crossed it", () => {
  // right half of the area is #c8c8c8 tone: after erasing, its pixels are close to 200
  let off = 0, n = 0;
  for (let y = 10; y < AH - 10; y++) for (let x = NW / 2 - AX + 20; x < AW - 10; x++) { const p = (y * AW + x) * 4; n++; if (Math.abs(out.data[p] - 200) > 25) off++; }
  assert.ok(off / n < 0.01, `${off} of ${n} tone pixels off level`);
});
const nullArea = await eraseFullSize(cv, crop(0, 0, 60, 40), 0, 0, mask, scale, 0, 0, { radius: 3 });
const shifted = await eraseFullSize(cv, area, AX, AY + 1000, mask, scale, 0, 1000, { radius: 3 });
const flatArea = await eraseFullSize(cv, crop(100, 150, 150, 90), 100, 150, mask, scale, 0, 0, { fill: "flat", color: [255, 255, 255] });
test("an area the mask doesn't reach returns null", () => {
  assert.equal(nullArea, null);
});
test("a slice origin is honoured (strip slices)", () => {
  // the same mask treated as a slice starting at page y=1000: the area moves with it
  assert.ok(shifted && dark(shifted) < dark(area) * 0.01);
});
test("a flat area takes its surface colour exactly (white part of the page)", () => {
  // the left half of the page is white: every masked pixel there becomes 255, no smear
  let off = 0; for (let p = 0; p < flatArea.data.length; p += 4) if (flatArea.data[p] !== 255 && flatArea.data[p] < 250) off++;
  assert.ok(off === 0, `${off} pixels not white`);
});
mask.delete();
console.log(`\n${passed} passed`);
