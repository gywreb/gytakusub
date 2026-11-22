// What the engine's worker has in a browser and Node does not, for tests that run the engine's
// entry points (memory.test.mjs, fail-paths.test.mjs): OffscreenCanvas (a node-canvas canvas, which
// draws and encodes the same way) and FileReader's data URL.
import { createCanvas } from "canvas";

globalThis.OffscreenCanvas ??= function OffscreenCanvas(w, h) {
  const c = createCanvas(w, h);
  c.convertToBlob = async ({ type = "image/png", quality } = {}) => new Blob([c.toBuffer(type, { quality })], { type });
  return c;
};
globalThis.FileReader ??= class {
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString("base64")}`; this.onload?.(); }, (e) => this.onerror?.(e)); }
};

/** A canvas as the worker's ImageBitmap (closed by its owner). */
export const bitmapOf = (c) => Object.assign(c, { close() {} });

/**
 * An ONNX model with the learned inpainter's inputs (image [1,3,H,W], mask [1,1,H,W]) whose fill
 * is the image itself: the engine's learned-fill path, through ONNX Runtime, at no cost.
 */
export function identityInpainter() {
  const varint = (n) => { const b = []; while (n > 127) { b.push((n & 127) | 128); n = Math.floor(n / 128); } b.push(n); return b; };
  const field = (no, bytes) => [...varint((no << 3) | 2), ...varint(bytes.length), ...bytes];
  const num = (no, n) => [...varint(no << 3), ...varint(n)];
  const str = (no, s) => field(no, [...Buffer.from(s)]);
  const dim = (d) => field(1, typeof d === "number" ? num(1, d) : str(2, d));
  const value = (name, dims) => [...str(1, name), ...field(2, field(1, [...num(1, 1), ...field(2, dims.flatMap(dim))]))];
  const node = [...str(1, "image"), ...str(2, "inpainted"), ...str(4, "Identity")];
  const graph = [...field(1, node), ...str(2, "identity"), ...field(11, value("image", [1, 3, "H", "W"])), ...field(11, value("mask", [1, 1, "H", "W"])), ...field(12, value("inpainted", [1, 3, "H", "W"]))];
  return new Uint8Array([...num(1, 7), ...field(8, num(2, 13)), ...field(7, graph)]);
}
