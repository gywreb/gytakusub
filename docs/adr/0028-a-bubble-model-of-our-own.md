# 0028. A bubble model of our own

Status: proposed (3.6.0): the training is set up; the model is measured before it ships.

## Context

The bubble model finds speech bubbles and draws their shape. Today's is kitsumed's YOLOv8m-seg (GPL-3.0, ADR 0004), quantized for the browser (ADR 0020). On generated webtoon pages it finds 34% of dark bubbles. ogkalu's comic detector finds 77%, but it gives only boxes, and end to end those cost bubble outlines and art (3.2.2, ADR 0024). A dark bubble the model misses is erased only from a reader's box, if at all (3.5, ADR 0027).

Generated pages know every bubble's shape exactly. 4.0's third step (roadmap, "4.0: the plan") fine-tunes today's model on them.

## Decision

1. **Training data: generated pages only** (`tests/bench/bubble-data.mjs`). Manga109-s and the owner's reports stay test sets. Training uses seeds from 1,000,000 and Ultralytics' own check during training uses seeds from 2,000,000, so the bench's pages (0–149 looked at, 100,000+ held out) are never trained on. Each page mixes the bench's kinds at random, fixed by its seed: lettering printed on things (half the pages), the owner's bubble shapes (half), a webtoon's dark bubbles (half), lettering at the image's cut (a quarter). Pages keep their lettering. 3,000 pages train, 300 check.
2. **The label is a bubble's inside and outline as one shape.** On 40 pages looked at, today's model draws its masks closer to that than to the inside alone: IoU 0.85 against 0.82 on light bubbles. The engine's rules were tuned on those masks. The generator cuts the inside half a pixel short of the outline, so the two are joined by a closing of 5 px before the shape is traced.
3. **Fine-tuned from today's weights** (kitsumed's `model.pt`, pinned revision `72da698`, checksum checked), so it keeps what it learned from real pages. The settings are fixed before any result: input 512 (the engine's), at most 40 passes with early stopping after 10 without gain, AdamW at 0.0005 falling to a tenth on a cosine, Ultralytics' default augmentation, seed 0.
4. **Two candidates:** every layer trained, and the backbone (layers 0–9) frozen. Freezing keeps more of what it learned on real pages and may learn less from the generated ones. The pages looked at choose between them, and the held-out pages count the winner.
5. **Trained on the owner's NVIDIA card** (`scripts/train-bubbles.py`, docs/TRAINING.md). The set is made on Linux, where the bench's fonts are. Ultralytics is pinned at 8.4.220.
6. **The export and quantization stay as today's.** ONNX with dynamic shapes at opset 19, as kitsumed's file was. Then `scripts/quantize-segment.py --weights-only --static 512`, which turns kitsumed's ONNX into today's `segment.onnx` byte for byte (checked: same SHA-256). Today's weights go through the same export (`base.onnx`), and must give today's numbers before the candidates are trusted.
7. **The project is AGPL-3.0**, so a model trained with Ultralytics' code ships under the same terms as today's.

## Gate (held-out pages)

- **Dark bubbles found at least 77%** (ogkalu's detector's rate), light ones no fewer (`bench/detectors.mjs bubbles`).
- **Real pages:** lettering still seen and art damage no worse.
- **Size and time no worse.** It's the same network, so they should match, but they're measured too.

The generated held-out pages come from the same generator as the training pages, so that half of the gate is easier than it looks. The real pages, which training never sees, are the true check.

## Measured

**The export path.** Today's weights, exported on the owner's machine by the training script (Ultralytics 8.4.220, PyTorch 2.14.1 with CUDA 13.0), match kitsumed's ONNX within 0.00002 in float32. After the same quantization, confidences differ by at most 0.0009. The files aren't byte-identical: 28.7 MB against 27.9 MB, from a newer exporter's graph. On 35 webtoon pages looked at, the two find the same bubbles on every page, with the same 5 false ones. A candidate's numbers below therefore come from its weights, not from the export.

The candidates: to come, after training.
