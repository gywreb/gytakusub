#!/usr/bin/env python3
"""Packs a training set (tests/bench/bubble-data.mjs) into zip parts of at most --part-mb each, to move
it to the computer that trains (docs/TRAINING.md). scripts/train-bubbles.py unpacks them.

    python3 scripts/pack-bubble-set.py <set dir> <out dir> [--part-mb 24]
"""
import argparse
import os
import zipfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("set")
ap.add_argument("out")
ap.add_argument("--part-mb", type=float, default=24)
a = ap.parse_args()
root, out = Path(a.set), Path(a.out)
out.mkdir(parents=True, exist_ok=True)
files = ["manifest.json", "data.yaml"] + sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and p.parts[len(root.parts)] in ("images", "labels"))
limit, part, size, z, n = a.part_mb * 1e6, 0, 0, None, 0
for f in files:
    s = os.path.getsize(root / f)
    if z is None or size + s > limit:
        if z: z.close()
        part += 1; size = 0
        z = zipfile.ZipFile(out / f"bubble-set-{part:02d}.zip", "w", zipfile.ZIP_STORED)  # (JPEGs don't compress)
    z.write(root / f, f.replace(os.sep, "/")); size += s; n += 1
z.close()
print(f"{n} files in {part} parts of at most {a.part_mb:g} MB, in {out}")
