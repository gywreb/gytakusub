# Third-party components

Gytakusub itself is licensed under the GNU AGPL v3 (see `LICENSE`). It bundles the
following, each under its own licence; the licence texts ship next to the files.

| Component | Files | Licence | Licence file |
|---|---|---|---|
| OpenCV.js 4.5.5 | `vendor/opencv.js`, `vendor/opencv_js.wasm` | Apache-2.0 | `vendor/LICENSE-OpenCV.txt` |
| ONNX Runtime Web 1.31.1 (Microsoft) | `vendor/ort/` | MIT | `vendor/ort/LICENSE-onnxruntime.txt` |
| PaddleOCR PP-OCRv6 (small) text detector | `vendor/ppocr-det.onnx`, `vendor/ppocr-det.json` | Apache-2.0 | `vendor/LICENSE-PaddleOCR.txt` |
| Speech-bubble segmentation model (kitsumed, Ultralytics YOLOv8m-seg), int8 weights | `vendor/segment.onnx` (CPU and WebGPU), `vendor/segment.json` | GPL-3.0 (model card) / Ultralytics AGPL-3.0 | `vendor/LICENSE-segment.txt` |
| AOT-GAN inpainting model trained on manga (lemon-manga-translator), float32 | `vendor/inpaint.onnx`, `vendor/inpaint.json` (source and checksum) | GPL-3.0 | `vendor/LICENSE-inpaint.txt` |
| LaMa inpainting finetuned on manga and anime (dreMaz/AnimeMangaInpainting, ONNX export by ogkalu), fixed at 512 px, float16 weights | `vendor/lama.onnx`, `vendor/lama.json` (source and checksum) | Apache-2.0 (export, LaMa); MIT (weights) | `vendor/LICENSE-lama.txt` |
| hyphen (hyphenation library) with English patterns | `vendor/hyphen-en.js` | ISC | `vendor/LICENSE-hyphen.txt` |
| Hyphenation patterns: German, Spanish, French, Italian, Dutch, Polish, Portuguese, Ukrainian (hyph-utf8, via hyphen) | `vendor/hyphen/*.json` | MIT, BSD-3-Clause (each file's terms) | `vendor/hyphen/LICENSE-patterns.txt` |
| Comic Neue Bold | `fonts/ComicNeue-Bold.ttf` | SIL OFL 1.1 | `fonts/LICENSE-ComicNeue.txt` |
| Comic Relief Bold (Jeff Davis) | `fonts/ComicRelief-Bold.ttf` | SIL OFL 1.1 | `fonts/LICENSE-ComicRelief.txt` |
| Mali Bold (Cadson Demak) | `fonts/Mali-Bold.ttf` | SIL OFL 1.1 | `fonts/LICENSE-Mali.txt` |

Apache-2.0, MIT, BSD-3-Clause, ISC and GPL-3.0 are compatible with distribution under AGPL-3.0;
the OFL fonts are distributed as separate font files, as that licence permits. The two added
fonts come unmodified from the Google Fonts repository (github.com/google/fonts, `ofl/comicrelief`
and `ofl/mali`, 2026-11-17). Hyphenation patterns under LPPL or GPL-2.0 (Russian, Turkish,
Indonesian) are not bundled.
How each was chosen: `docs/adr/0001-dependencies.md`, `0002`, `0004`, `0005`, `0011` (fonts and hyphenation), `0013` (AOT), `0015` (LaMa).
