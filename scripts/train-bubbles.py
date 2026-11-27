#!/usr/bin/env python3
"""Fine-tune the bubble model on generated pages (4.0 step 3, ADR 0028). Runs on a computer with an
NVIDIA graphics card; docs/TRAINING.md has the steps for Windows.

    python scripts/train-bubbles.py --set <folder with bubble-set-*.zip or the extracted set> [--out <folder>] [--smoke]

What it does, in order:
  1. Checks the graphics card (CUDA). It refuses to train on the CPU unless --cpu is given.
  2. Unpacks the training set (tests/bench/bubble-data.mjs makes it: generated pages only) and checks
     its manifest.
  3. Downloads today's bubble model's weights (kitsumed's model.pt, pinned revision) and checks
     their checksum.
  4. Trains two candidates from those weights, with settings fixed before any result:
       all     every layer trained
       frozen  the backbone (layers 0-9) frozen: it keeps more of what it learned on real pages
  5. Exports today's weights and both candidates to ONNX as today's model was exported (dynamic
     shapes, opset 19), and writes summary.json (versions, settings, checksums, each candidate's
     best pass).
The ONNX files are what Claude fetches back; quantizing and measuring happen there
(scripts/quantize-segment.py, then the bench). --smoke trains one short pass on 2% of the set, to
check the setup in a few minutes; its files are not for measuring.
"""
import argparse
import csv
import glob
import hashlib
import json
import os
import platform
import shutil
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

BASE_URL = "https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble/resolve/72da69887f170d64734b14f3f0fc9e41762d01e0/model.pt"
BASE_SHA256 = "200141c44d4153662050531905ec3354d1d6302c28939dbbb019c037250ed610"
ULTRALYTICS = "8.4.220"

# Fixed before any result (ADR 0028). The pages looked at choose between the two candidates; held-out
# pages only count the winner.
SETTINGS = dict(
    imgsz=512,            # the engine's input (extension/vendor/segment.json)
    epochs=40, patience=10,
    batch=16,
    optimizer="AdamW", lr0=0.0005, lrf=0.1, cos_lr=True, warmup_epochs=1.0,
    seed=0, deterministic=True,
    # Ultralytics' default augmentation (mosaic, scale, translate, flips left-right, HSV), unchanged
)
CANDIDATES = {"all": None, "frozen": 10}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def say(msg):
    print(f"[train-bubbles] {msg}", flush=True)


def unpack(set_dir: Path) -> Path:
    """The extracted set: <set>/data (from the zip parts, once), or <set> itself."""
    if (set_dir / "manifest.json").exists():
        return set_dir
    parts = sorted(glob.glob(str(set_dir / "bubble-set-*.zip")))
    if not parts:
        sys.exit(f"no training set in {set_dir}: expected bubble-set-*.zip or manifest.json")
    data = set_dir / "data"
    if not (data / "manifest.json").exists():
        say(f"unpacking {len(parts)} parts into {data}")
        for p in parts:
            with zipfile.ZipFile(p) as z:
                z.extractall(data)
    return data


def best_pass(run_dir: Path):
    rows = list(csv.DictReader(open(run_dir / "results.csv", newline="")))
    rows = [{k.strip(): v.strip() for k, v in r.items()} for r in rows]
    key = "metrics/mAP50-95(M)"
    best = max(rows, key=lambda r: float(r.get(key) or 0))
    return {"passes": len(rows), "best": int(float(best["epoch"])), "mask mAP50-95": float(best[key]), "mask mAP50": float(best.get("metrics/mAP50(M)") or 0)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--set", required=True, help="folder with bubble-set-*.zip (or the extracted set)")
    ap.add_argument("--out", default=None, help="where runs and ONNX files go (default: <set>/out)")
    ap.add_argument("--smoke", action="store_true", help="one short pass on 2%% of the set, to check the setup")
    ap.add_argument("--cpu", action="store_true", help="allow training on the CPU (about 8 hours)")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    import torch
    import ultralytics
    from ultralytics import YOLO

    if ultralytics.__version__ != ULTRALYTICS:
        say(f"warning: Ultralytics {ultralytics.__version__}, the plan pins {ULTRALYTICS} (pip install ultralytics=={ULTRALYTICS})")
    if torch.cuda.is_available():
        device, gpu = 0, torch.cuda.get_device_name(0)
        say(f"graphics card: {gpu} (CUDA {torch.version.cuda}, PyTorch {torch.__version__})")
    elif args.cpu:
        device, gpu = "cpu", None
        say("no CUDA: training on the CPU (--cpu)")
    else:
        sys.exit("PyTorch sees no NVIDIA graphics card (torch.cuda.is_available() is False). Install the CUDA build of PyTorch (docs/TRAINING.md), or pass --cpu.")

    set_dir = Path(args.set).resolve()
    data = unpack(set_dir)
    manifest = json.load(open(data / "manifest.json", encoding="utf-8"))
    pages = {k: v["pages"] for k, v in manifest["set"].items()}
    say(f"training set: {pages['train']} pages, check: {pages['val']} pages (generated, seeds {manifest['splits']['train']['first']}+ and {manifest['splits']['val']['first']}+)")
    yaml = data / "train.yaml"
    yaml.write_text(f"path: {data.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: speech bubble\n", encoding="utf-8")

    out = Path(args.out).resolve() if args.out else set_dir / ("out-smoke" if args.smoke else "out")
    out.mkdir(parents=True, exist_ok=True)
    base = out / "base.pt"
    if not base.exists() or sha256(base) != BASE_SHA256:
        say("downloading today's weights (kitsumed/yolov8m_seg-speech-bubble, pinned)")
        urllib.request.urlretrieve(BASE_URL, base)
    if sha256(base) != BASE_SHA256:
        sys.exit(f"base.pt checksum {sha256(base)} is not the pinned {BASE_SHA256}")

    settings = dict(SETTINGS)
    if args.smoke:
        settings.update(epochs=1, patience=1, fraction=0.02)
    summary = {
        "versions": {"python": platform.python_version(), "torch": torch.__version__, "cuda": torch.version.cuda, "ultralytics": ultralytics.__version__, "gpu": gpu, "os": platform.platform()},
        "set": {"manifest": manifest, "pages": pages}, "base": {"url": BASE_URL, "sha256": BASE_SHA256},
        "settings": settings, "smoke": args.smoke, "candidates": {},
    }
    weights = {"base": base}
    for name, freeze in CANDIDATES.items():
        say(f"training '{name}'" + (f" (layers 0-{freeze - 1} frozen)" if freeze else " (every layer)"))
        t0 = time.time()
        YOLO(str(base)).train(data=str(yaml), project=str(out / "runs"), name=name, exist_ok=True, device=device,
                              workers=args.workers, freeze=freeze, plots=True, **settings)
        run = out / "runs" / name
        weights[name] = run / "weights" / "best.pt"
        summary["candidates"][name] = {"freeze": freeze, "minutes": round((time.time() - t0) / 60, 1), **best_pass(run)}
        say(f"'{name}': {summary['candidates'][name]}")

    onnx_dir = out / "onnx"
    onnx_dir.mkdir(exist_ok=True)
    for name, w in weights.items():
        f = YOLO(str(w)).export(format="onnx", imgsz=512, dynamic=True, opset=19, simplify=True, device="cpu")
        dst = onnx_dir / f"{name}.onnx"
        shutil.move(f, dst)
        summary.setdefault("onnx", {})[name] = {"file": dst.name, "bytes": dst.stat().st_size, "sha256": sha256(dst)}
        say(f"exported {dst}")
    json.dump(summary, open(out / "summary.json", "w", encoding="utf-8"), indent=2)
    say(f"done: {onnx_dir} holds base.onnx, all.onnx, frozen.onnx; {out / 'summary.json'} the rest.")
    if args.smoke:
        say("(a smoke run: the setup works; run again without --smoke for the real training)")


if __name__ == "__main__":  # (Windows: the data loader's worker processes import this file)
    main()
