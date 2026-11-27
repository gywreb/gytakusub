# Training the bubble model

Gytakusub's bubble model finds speech bubbles and draws their shape. Today's comes from
[kitsumed/yolov8m_seg-speech-bubble](https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble)
(GPL-3.0). It finds about a third of the dark bubbles on generated webtoon pages (3.2.2, ADR 0024).
4.0 fine-tunes it on generated pages, which know every bubble's shape exactly (roadmap, 4.0 step 3;
ADR 0028).

Training needs an NVIDIA graphics card to be quick. On a CPU it takes about 8 hours.

## What's trained on

- **Generated pages only** (`tests/bench/bubble-data.mjs`). Manga109-s and debug reports are test sets and are never trained on.
- **Seeds from 1,000,000** for training and **from 2,000,000** for the check Ultralytics runs during training. The bench's pages (0–149 looked at, 100,000+ held out) are never used.
- **Each page mixes the bench's kinds** at random: lettering printed on things, the owners' bubble shapes, a webtoon's dark bubbles, and lettering at the image's cut.
- **The label is the bubble's inside and outline as one shape**, as today's model draws it.

The set is made on Linux, where the bench's fonts are. The generator draws lettering with Noto CJK, DejaVu and other Linux fonts, and Windows would substitute others. Make it with:

```sh
cd tests
# 40 pages a process: the generator holds about 75 MB a page until its process ends
until node bench/bubble-data.mjs ../.bubble-train --train 3000 --val 300 --max 40 | grep -q '^done'; do :; done
cd ..
python3 scripts/pack-bubble-set.py .bubble-train .bubble-train/parts   # zip parts of 24 MB, to move to the computer that trains
```

Copy the parts into `.bubble-train` on the computer that trains. `scripts/train-bubbles.py` unpacks them.

## Training on Windows

In PowerShell, in your clone of the repo:

1. **The script:** `scripts\train-bubbles.py` from the branch (`git fetch origin; git checkout core/3.6.0`), or a copy next to the set (`.bubble-train\train-bubbles.py`). It needs nothing else from the repo.
2. **Python 3.12** from [python.org](https://www.python.org/downloads/) (tick "Add python.exe to PATH"). Then make an environment for training:
   ```powershell
   py -3.12 -m venv .bubble-train\venv
   .bubble-train\venv\Scripts\Activate.ps1
   ```
   If PowerShell refuses to run the script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
3. **PyTorch with CUDA:** on [pytorch.org](https://pytorch.org/get-started/locally/), choose Stable, Windows, Pip, Python and the highest CUDA version listed. Run the command it shows. Check that it sees the card:
   ```powershell
   python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
   ```
   It must print `True` and your card's name.
4. **Ultralytics, pinned:**
   ```powershell
   pip install ultralytics==8.4.220
   ```
5. **A smoke run first** (a few minutes: one short pass, checking the setup):
   ```powershell
   python .bubble-train\train-bubbles.py --set .bubble-train --smoke
   ```
6. **The training** (both candidates, then the export):
   ```powershell
   python .bubble-train\train-bubbles.py --set .bubble-train
   ```

If it stops with `CUDA out of memory`, close what else uses the card (a live wallpaper, games) or add `--batch 8`. The batch size goes into `summary.json`.

When it ends, `.bubble-train\out\onnx` holds `base.onnx`, `all.onnx` and `frozen.onnx`, and
`.bubble-train\out\summary.json` holds the versions, settings and each candidate's best pass.
`base.onnx` is today's weights through the same export, to check the path against today's model.

## After training

The ONNX files are quantized as today's model is (`scripts/quantize-segment.py --weights-only --static 512`,
ADR 0020) and measured on the bench. The pages looked at choose between the two candidates, and the
held-out pages count the winner against the gate (ADR 0028). Only then is it vendored
(`scripts/vendor-segment.mjs`).
