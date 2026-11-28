#!/usr/bin/env python3
"""Fine-tune the learned text mask (comic-text-mask, a U-Net on a ResNet-18, MIT) on generated crops,
so it stops taking hatching and other art for lettering (4.0 step 2, docs/TRAINING.md). Runs on a
computer with an NVIDIA graphics card.

    python scripts/train-textmask.py --set <folder with textmask-set-*.zip or the extracted set> [--out <folder>] [--smoke]

What it does, in order:
  1. Checks the graphics card (CUDA); refuses the CPU unless --cpu.
  2. Unpacks the crops (tests/bench/textmask-data.mjs: generated pages only) and checks the manifest.
  3. Downloads the authors' weights (model.safetensors and config.json, pinned revision) and checks
     their checksums.
  4. Measures them on the check crops (the baseline), then trains two candidates from them, with
     settings fixed before any result: the authors' recipe (Dice + BCE, AdamW, cosine, their
     augmentation) at a quarter of their learning rate and at most 15 passes, stopping after 3
     without gain in the check crops' IoU:
       all     every layer trained
       frozen  the encoder (the ResNet-18) frozen, batch norms and all: the decoder alone learns
  5. Saves each candidate's best weights as model.safetensors + config.json, as the authors publish
     them (scripts/textmask-onnx.py turns them into the vendored ONNX, without PyTorch), and
     summary.json (versions, settings, every pass's numbers).
Crops are brought to 384 x 384 as the engine does (engine/textmask.js): the long side scaled to
384, at the top left, the rest 0. --smoke trains one short pass on a few hundred crops, to check
the setup.
"""
import argparse
import glob
import hashlib
import json
import os
import platform
import random
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

REV = "ebd37f1a9ae9298519678fb96a796573fb602977"
BASE = {
    "model.safetensors": ("https://huggingface.co/TareHimself/comic-text-mask/resolve/" + REV + "/model.safetensors", "ab28dd8450462c4f87ddfd05d13601813bb90414f26bea5590bf6a0a7540f988"),
    "config.json": ("https://huggingface.co/TareHimself/comic-text-mask/resolve/" + REV + "/config.json", "96eaf2951021cabe41e0b339e56c109907a97f3a693a77cfc79ae7bea07485d5"),
}
SMP = "0.5.0"  # the authors' (comic-localizer-text-masking, uv.lock)
IMGSZ = 384
# Fixed before any result. The authors': lr 4e-4, weight decay 1e-4, 80 passes, patience 8, batch 64.
SETTINGS = dict(lr=1e-4, weight_decay=1e-4, epochs=15, patience=3, batch=32, threshold=0.5, seed=0)
CANDIDATES = ["all", "frozen"]

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from torch.utils.data import Dataset  # noqa: E402

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def letterbox(img, mask):
    """As the engine: the long side to IMGSZ, at the top left, 0 elsewhere (textmask.js)."""
    h, w = img.shape[:2]
    s = IMGSZ / max(h, w)
    nh, nw = min(IMGSZ, round(h * s)), min(IMGSZ, round(w * s))
    img = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    mask = cv2.resize(mask, (nw, nh), interpolation=cv2.INTER_NEAREST)
    oi = np.zeros((IMGSZ, IMGSZ, 3), np.uint8)
    om = np.zeros((IMGSZ, IMGSZ), np.uint8)
    oi[:nh, :nw] = img
    om[:nh, :nw] = mask
    return oi, om


def augment(img, mask):
    """The authors' (comic-localizer-text-masking, seg/data.py): zoom, flips, brightness."""
    if random.random() < 0.4:
        h, w = mask.shape
        s = random.uniform(0.3, 1.0)
        cw, ch = max(8, int(w * s)), max(8, int(h * s))
        ys, xs = np.where(mask > 127)
        if len(xs):
            cx, cy = (int(xs.min()) + int(xs.max())) // 2, (int(ys.min()) + int(ys.max())) // 2
            x0 = min(max(random.randint(cx - cw + 1, cx), 0), w - cw)
            y0 = min(max(random.randint(cy - ch + 1, cy), 0), h - ch)
        else:
            x0, y0 = random.randint(0, w - cw), random.randint(0, h - ch)
        img = cv2.resize(img[y0:y0 + ch, x0:x0 + cw], (w, h), interpolation=cv2.INTER_LINEAR)
        mask = cv2.resize(mask[y0:y0 + ch, x0:x0 + cw], (w, h), interpolation=cv2.INTER_NEAREST)
    if random.random() < 0.5:
        img, mask = img[:, ::-1], mask[:, ::-1]
    if random.random() < 0.2:
        img, mask = img[::-1], mask[::-1]
    img = img.astype(np.float32)
    if random.random() < 0.5:
        img = np.clip(img * (0.6 + random.random() * 0.8), 0, 255)
    return img, mask


class Crops(Dataset):
    """One split's crops: (image, mask, is it art alone)."""

    def __init__(self, root, split, train, limit=0):
        self.files = sorted(glob.glob(os.path.join(str(root), split, "images", "*.jpg")))
        if limit:
            self.files = self.files[:limit]
        self.train = train

    def __len__(self):
        return len(self.files)

    def __getitem__(self, i):
        f = self.files[i]
        img = cv2.cvtColor(cv2.imread(f, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
        d, n = os.path.split(f)
        mask = cv2.imread(os.path.join(os.path.dirname(d), "masks", n[:-4] + ".png"), cv2.IMREAD_GRAYSCALE)
        img, mask = letterbox(img, mask)
        if self.train:
            img, mask = augment(img, mask)
        x = (np.asarray(img, np.float32) / 255.0 - MEAN) / STD
        return (torch.from_numpy(np.ascontiguousarray(x.transpose(2, 0, 1))),
                torch.from_numpy(np.ascontiguousarray((mask > 127).astype(np.float32)))[None],
                "-art" in n)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def say(msg):
    print(f"[train-textmask] {msg}", flush=True)


def unpack(set_dir: Path) -> Path:
    if (set_dir / "manifest.json").exists():
        return set_dir
    parts = sorted(glob.glob(str(set_dir / "textmask-set-*.zip")))
    if not parts:
        sys.exit(f"no training set in {set_dir}: expected textmask-set-*.zip or manifest.json")
    data = set_dir / "data"
    if not (data / "manifest.json").exists():
        say(f"unpacking {len(parts)} parts into {data}")
        for p in parts:
            with zipfile.ZipFile(p) as z:
                z.extractall(data)
    return data


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--set", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--batch", type=int, default=SETTINGS["batch"], help="crops a step (32; 16 if the card runs out of memory)")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    import torch.nn as nn
    import segmentation_models_pytorch as smp
    from safetensors.torch import load_file, save_file
    from torch.utils.data import DataLoader

    if smp.__version__ != SMP:
        say(f"warning: segmentation-models-pytorch {smp.__version__}, the plan pins {SMP} (pip install segmentation-models-pytorch=={SMP})")
    if torch.cuda.is_available():
        device, gpu = torch.device("cuda"), torch.cuda.get_device_name(0)
        say(f"graphics card: {gpu} (CUDA {torch.version.cuda}, PyTorch {torch.__version__})")
    elif args.cpu:
        device, gpu = torch.device("cpu"), None
    else:
        sys.exit("PyTorch sees no NVIDIA graphics card. Install the CUDA build of PyTorch (docs/TRAINING.md), or pass --cpu.")

    random.seed(SETTINGS["seed"]); np.random.seed(SETTINGS["seed"]); torch.manual_seed(SETTINGS["seed"])
    set_dir = Path(args.set).resolve()
    data = unpack(set_dir)
    manifest = json.load(open(data / "manifest.json", encoding="utf-8"))
    out = Path(args.out).resolve() if args.out else set_dir / ("out-smoke" if args.smoke else "out")
    out.mkdir(parents=True, exist_ok=True)
    base = out / "base"
    base.mkdir(exist_ok=True)
    for name, (url, digest) in BASE.items():
        f = base / name
        if not f.exists() or sha256(f) != digest:
            say(f"downloading the authors' {name} (pinned)")
            urllib.request.urlretrieve(url, f)
        if sha256(f) != digest:
            sys.exit(f"{name}: checksum {sha256(f)} is not the pinned {digest}")
    cfg = json.load(open(base / "config.json"))

    def build():
        kw = {k: v for k, v in cfg.items() if not k.startswith("_")}
        m = smp.Unet(**kw)
        m.load_state_dict(load_file(str(base / "model.safetensors")))
        return m

    limit = 300 if args.smoke else 0
    train_dl = DataLoader(Crops(data, "train", True, limit), batch_size=args.batch, shuffle=True, num_workers=args.workers, pin_memory=True, drop_last=True)
    val_dl = DataLoader(Crops(data, "val", False, limit), batch_size=args.batch, shuffle=False, num_workers=args.workers, pin_memory=True)
    say(f"crops: {len(train_dl.dataset)} to train on, {len(val_dl.dataset)} to check (generated pages: {manifest['set']})")

    dice = smp.losses.DiceLoss(mode="binary")
    bce = nn.BCEWithLogitsLoss()

    def evaluate(model):
        """IoU, precision and recall of text pixels on the check crops, and on the crops of art
        alone, the share of their pixels called text (what the mask must not take)."""
        model.eval()
        tp = fp = fn = 0
        art_px = art_on = 0
        with torch.no_grad():
            for x, y, art in val_dl:
                x, y = x.to(device), y.to(device)
                p = (torch.sigmoid(model(x)) > SETTINGS["threshold"]).float()
                tp += (p * y).sum().item(); fp += (p * (1 - y)).sum().item(); fn += ((1 - p) * y).sum().item()
                a = art.to(device).bool()
                if a.any():
                    art_on += p[a].sum().item(); art_px += p[a].numel()
        return {"iou": tp / max(1, tp + fp + fn), "precision": tp / max(1, tp + fp), "recall": tp / max(1, tp + fn), "art called text": art_on / max(1, art_px)}

    settings = dict(SETTINGS, batch=args.batch)
    if args.smoke:
        settings.update(epochs=1, patience=1)
    summary = {
        "versions": {"python": platform.python_version(), "torch": torch.__version__, "cuda": torch.version.cuda, "smp": smp.__version__, "gpu": gpu, "os": platform.platform()},
        "set": manifest, "base": {"revision": REV, **{k: v[1] for k, v in BASE.items()}}, "settings": settings, "smoke": args.smoke, "candidates": {},
    }
    m0 = build().to(device)
    summary["base"]["check"] = evaluate(m0)
    say(f"the authors' weights on the check crops: {summary['base']['check']}")
    del m0

    for name in CANDIDATES:
        torch.manual_seed(SETTINGS["seed"]); random.seed(SETTINGS["seed"])
        model = build().to(device)
        if name == "frozen":
            for p in model.encoder.parameters():
                p.requires_grad = False
        params = [p for p in model.parameters() if p.requires_grad]
        opt = torch.optim.AdamW(params, lr=settings["lr"], weight_decay=settings["weight_decay"])
        sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=settings["epochs"])
        scaler = torch.amp.GradScaler(enabled=device.type == "cuda")
        best, best_epoch, stale, passes = -1.0, 0, 0, []
        dst = out / name
        dst.mkdir(exist_ok=True)
        t0 = time.time()
        for epoch in range(1, settings["epochs"] + 1):
            model.train()
            if name == "frozen":
                model.encoder.eval()  # its batch norms keep the authors' statistics
            total = 0.0
            for x, y, _ in train_dl:
                x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
                opt.zero_grad(set_to_none=True)
                with torch.autocast(device_type=device.type, enabled=device.type == "cuda"):
                    logits = model(x)
                logits = logits.float()  # (the loss in float32: Dice on half precision is unsteady)
                loss = dice(logits, y) + bce(logits, y)
                scaler.scale(loss).backward()
                scaler.step(opt); scaler.update()
                total += loss.item()
            sched.step()
            m = evaluate(model)
            passes.append({"epoch": epoch, "loss": total / max(1, len(train_dl)), **m})
            say(f"'{name}' pass {epoch}: loss {passes[-1]['loss']:.4f}, check {m}")
            if m["iou"] > best:
                best, best_epoch, stale = m["iou"], epoch, 0
                save_file({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}, str(dst / "model.safetensors"))
                json.dump(cfg, open(dst / "config.json", "w"), indent=2)
            else:
                stale += 1
                if stale >= settings["patience"]:
                    break
        summary["candidates"][name] = {"minutes": round((time.time() - t0) / 60, 1), "best": best_epoch, "passes": passes, "sha256": sha256(dst / "model.safetensors")}
        say(f"'{name}': best pass {best_epoch}, check IoU {best:.4f}")
        json.dump(summary, open(out / "summary.json", "w", encoding="utf-8"), indent=2)
    say(f"done: {out / 'all'} and {out / 'frozen'} hold model.safetensors + config.json; {out / 'summary.json'} the rest.")
    if args.smoke:
        say("(a smoke run: the setup works; run again without --smoke for the real training)")


if __name__ == "__main__":  # (Windows: the data loader's worker processes import this file)
    main()
