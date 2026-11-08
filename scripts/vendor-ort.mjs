// Vendors ONNX Runtime Web (Microsoft, MIT) from the onnxruntime-web npm package
// into extension/vendor/ort/: the single-file ESM bundle (the wasm loader is
// inlined — a module service worker cannot use dynamic import()) and the
// single-threaded SIMD wasm. Nothing else from the package is shipped.
//   node scripts/vendor-ort.mjs   (run from tests/ after npm install)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "tests", "node_modules", "onnxruntime-web");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const out = path.join(root, "extension", "vendor", "ort");
fs.mkdirSync(out, { recursive: true });
// the ESM bundle is renamed .js: some static hosts do not serve .mjs as JavaScript
fs.copyFileSync(path.join(pkgDir, "dist", "ort.wasm.bundle.min.mjs"), path.join(out, "ort.bundle.js"));
fs.copyFileSync(path.join(pkgDir, "dist", "ort-wasm-simd-threaded.wasm"), path.join(out, "ort-wasm-simd-threaded.wasm"));
const lic = ["LICENSE", "LICENSE.txt", "LICENSE.md"].map((f) => path.join(pkgDir, f)).find(fs.existsSync);
fs.writeFileSync(path.join(out, "LICENSE-onnxruntime.txt"), lic ? fs.readFileSync(lic) : `onnxruntime-web ${pkg.version} — ${pkg.license} License, Copyright (c) Microsoft Corporation. https://github.com/microsoft/onnxruntime\n`);
fs.writeFileSync(path.join(out, "VERSION.json"), JSON.stringify({ package: "onnxruntime-web", version: pkg.version, files: { "ort.bundle.js": "dist/ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.wasm": "dist/ort-wasm-simd-threaded.wasm" } }, null, 2) + "\n");
console.log(`vendored onnxruntime-web ${pkg.version} into extension/vendor/ort/`);
