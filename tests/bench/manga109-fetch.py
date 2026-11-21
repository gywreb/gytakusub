# Downloads the Manga109-s pages the bench reads (manga109-pick.tsv: 4 spreads from each of the 87
# books, and which half of the books each is in) and the books' annotations, by range requests into
# the dataset's zip on Hugging Face (3.3 GB; about 180 MB is read).
#   pip install remotezip
#   HF_TOKEN=<a read token of an account granted access to hal-utokyo/Manga109-s> python3 manga109-fetch.py <out dir>
# Manga109-s may not be redistributed: <out dir> stays on your machine, outside the repository
# (or in tests/bench/data/, which git ignores).
import os, sys
from remotezip import RemoteZip
here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]
url = "https://huggingface.co/datasets/hal-utokyo/Manga109-s/resolve/main/Manga109s_released_2026_05_21.zip"
root = "Manga109s_released_2026_05_21/"
pick = [l.split("\t") for l in open(os.path.join(here, "manga109-pick.tsv")).read().split("\n") if l]
with RemoteZip(url, headers={"Authorization": "Bearer " + os.environ["HF_TOKEN"]}) as z:
    for b in sorted(set(p[1] for p in pick)):
        for kind in ("annotations", "annotations_COO"):
            dst = f"{out}/{kind}/{b}.xml"
            if os.path.exists(dst): continue
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try: open(dst, "wb").write(z.read(f"{root}{kind}/{b}.xml"))
            except KeyError: pass
    for i, (half, b, n) in enumerate(pick):
        dst = f"{out}/images/{b}/{os.path.basename(n)}"
        if os.path.exists(dst): continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "wb").write(z.read(n))
        if i % 50 == 0: print(i, "of", len(pick), flush=True)
print("done")
