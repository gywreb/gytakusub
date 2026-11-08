// Loads the vendored OpenCV.js in Node for tests (same files the extension ships).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
// Emscripten's Node branch expects CommonJS globals.
globalThis.__dirname ??= here;
globalThis.require ??= createRequire(import.meta.url);
import { ImageData } from "canvas";
globalThis.ImageData ??= ImageData; // engine/erase.js constructs ImageData like a browser would
const { getCV } = await import("../extension/engine/cv.js");
export const cv = await getCV({ wasmBinary: fs.readFileSync(path.join(here, "../extension/vendor/opencv_js.wasm")) });
