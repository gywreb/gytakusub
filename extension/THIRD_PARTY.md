# Third-party components

Gytakusub itself is licensed under the GNU AGPL v3 (see `LICENSE`). It bundles the
following, each under its own licence; the licence texts ship next to the files.

| Component | Files | Licence | Licence file |
|---|---|---|---|
| OpenCV.js 4.5.5 | `vendor/opencv.js`, `vendor/opencv_js.wasm` | Apache-2.0 | `vendor/LICENSE-OpenCV.txt` |
| ONNX Runtime Web 1.31.1 (Microsoft) | `vendor/ort/` | MIT | `vendor/ort/LICENSE-onnxruntime.txt` |
| PaddleOCR PP-OCRv4 text detector | `vendor/ppocr-det.onnx` | Apache-2.0 | `vendor/LICENSE-PaddleOCR.txt` |
| Speech-bubble segmentation model (kitsumed, Ultralytics YOLOv8m-seg), int8 | `vendor/segment.onnx` | GPL-3.0 (model card) / Ultralytics AGPL-3.0 | `vendor/LICENSE-segment.txt` |
| English hyphenation patterns (hyphen) | `vendor/hyphen-en.js` | ISC | `vendor/LICENSE-hyphen.txt` |
| Comic Neue Bold | `fonts/ComicNeue-Bold.ttf` | SIL OFL 1.1 | `fonts/LICENSE-ComicNeue.txt` |

Apache-2.0, MIT, ISC and GPL-3.0 are compatible with distribution under AGPL-3.0;
the OFL font is distributed as a separate font file, as that licence permits.
How each was chosen: `docs/adr/0001-dependencies.md`, `0002`, `0004`.
