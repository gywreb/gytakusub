#!/usr/bin/env python3
"""Packs a training set (tests/bench/bubble-data.mjs, tests/bench/textmask-data.mjs) into zip parts of
at most --part-mb each, to move it to the computer that trains (docs/TRAINING.md). The training
scripts unpack them.

    python3 scripts/pack-set.py <set dir> <out dir> --name bubble-set|textmask-set [--part-mb 24]
"""
import argparse
import os
import zipfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("set")
ap.add_argument("out")
ap.add_argument("--name", required=True, help="the parts' name: <name>-01.zip, ...")
ap.add_argument("--part-mb", type=float, default=24)
a = ap.parse_args()
root, out = Path(a.set), Path(a.out)
out.mkdir(parents=True, exist_ok=True)
# every file of the set but the generator's own bookkeeping (done/), the manifest first
files = sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and "done" not in p.relative_to(root).parts and p.parent != out)
files.sort(key=lambda f: f != "manifest.json")
limit, part, size, z, n = a.part_mb * 1e6, 0, 0, None, 0
# (a part also holds each file's headers, about 200 bytes with its name: counted with the file)
for f in files:
    s = os.path.getsize(root / f) + 200
    if z is None or size + s > limit:
        if z: z.close()
        part += 1; size = 0
        z = zipfile.ZipFile(out / f"{a.name}-{part:02d}.zip", "w", zipfile.ZIP_STORED)  # (JPEGs and PNGs don't compress)
    z.write(root / f, f.replace(os.sep, "/")); size += s; n += 1
z.close()
print(f"{n} files in {part} parts of at most {a.part_mb:g} MB, in {out}")
