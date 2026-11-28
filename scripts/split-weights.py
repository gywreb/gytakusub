"""Split each trained text mask into 8 MB pieces so they can be fetched.

Run from C:\\Dev\\gytakusub:  python .textmask-train\\split-weights.py
Writes .textmask-train\\out\\<version>\\parts\\model.partNN and prints each file's sha256.
"""
import hashlib
import pathlib

PART = 8 * 1024 * 1024
out = pathlib.Path(__file__).resolve().parent / "out"

for version in ("all", "frozen"):
    src = out / version / "model.safetensors"
    data = src.read_bytes()
    parts = out / version / "parts"
    parts.mkdir(exist_ok=True)
    for old in parts.glob("model.part*"):
        old.unlink()
    for n, at in enumerate(range(0, len(data), PART)):
        (parts / f"model.part{n:02d}").write_bytes(data[at:at + PART])
    print(version, len(data), "bytes,", n + 1, "parts, sha256", hashlib.sha256(data).hexdigest())
print("done")
