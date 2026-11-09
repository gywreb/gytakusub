"""A procedural, IP-free page of vertical Japanese with ruby (furigana), for the
engine tests: three white bubbles, each holding two or three columns, with the
reading of some kanji set in small kana beside them — as manga print it. One
bubble sits at the right edge of the page, where an error in mapping detector
boxes back to the page is largest. The page is 1096 x 1600, whose width does
not shrink to a multiple of 32 at the detector's scale.

  python3 make-ruby-page.py <outdir>

Writes <outdir>/ruby-00.png and ruby-00.truth.json: per bubble, its box, the
columns' boxes (main glyphs only), the box of all lettering (ruby included) and
the glyph size. Needs Pillow and a Noto CJK font.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

CJK = next((p for p in ["/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"] if os.path.exists(p)), None)
if not CJK:
    sys.exit("No Noto CJK font found (install fonts-noto-cjk)")

W, H = 1096, 1600
GLYPH, RUBY = 30, 14
# columns right to left; each column is a list of (text, ruby or None)
BUBBLES = [
    {"c": (300, 330), "r": (150, 190), "cols": [[("本当", "ほんとう"), ("に", None)], [("大丈夫", "だいじょうぶ"), ("か？", None)]]},
    {"c": (560, 1000), "r": (170, 220), "cols": [[("約束", "やくそく"), ("した", None)], [("だろう…！！", None)], [("忘", "わす"), ("れるな", None)]]},
    {"c": (940, 520), "r": (140, 200), "cols": [[("仲間", "なかま"), ("を", None)], [("守", "まも"), ("るんだ", None)]]},
]


def main(outdir):
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    big, small = ImageFont.truetype(CJK, GLYPH), ImageFont.truetype(CJK, RUBY)
    # panel frames and a little hatching, so the page is not only bubbles
    for (x0, y0, x1, y1) in [(40, 40, 1056, 760), (40, 790, 1056, 1560)]:
        d.rectangle([x0, y0, x1, y1], outline="black", width=6)
        for x in range(x0 + 20, x1 - 20, 23):
            d.line([(x, y1 - 160), (x + 40, y1 - 20)], fill="black", width=2)
    truth = []
    for b in BUBBLES:
        (cx, cy), (rx, ry) = b["c"], b["r"]
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill="white", outline="black", width=5)
        pitch = GLYPH * 1.6  # column pitch: glyph + room for its ruby
        ncol = len(b["cols"])
        length = max(sum(len(t) for t, _ in col) for col in b["cols"]) * GLYPH * 1.05
        x = cx + pitch * (ncol - 1) / 2 - GLYPH / 2  # left edge of the rightmost column
        cols, allbox = [], [1e9, 1e9, -1e9, -1e9]
        for col in b["cols"]:
            y = cy - length / 2
            top = y
            for text, ruby in col:
                y0 = y
                for ch in text:
                    d.text((x, y), ch, font=big, fill="black")
                    y += GLYPH * 1.05
                if ruby:  # the reading, centred along its kanji, just right of them
                    span = y - y0
                    ry0 = y0 + (span - len(ruby) * RUBY) / 2
                    for i, ch in enumerate(ruby):
                        d.text((x + GLYPH + 2, ry0 + i * RUBY), ch, font=small, fill="black")
                    allbox = [min(allbox[0], x), min(allbox[1], ry0), max(allbox[2], x + GLYPH + 2 + RUBY), max(allbox[3], ry0 + len(ruby) * RUBY)]
            cols.append([round(x), round(top), GLYPH, round(y - top)])
            allbox = [min(allbox[0], x), min(allbox[1], top), max(allbox[2], x + GLYPH), max(allbox[3], y)]
            x -= pitch
        truth.append({"box": [cx - rx, cy - ry, 2 * rx, 2 * ry], "columns": cols,
                      "lettering": [round(allbox[0]) - 2, round(allbox[1]) - 2, round(allbox[2] - allbox[0]) + 4, round(allbox[3] - allbox[1]) + 4], "glyph": GLYPH})
    os.makedirs(outdir, exist_ok=True)
    img.save(os.path.join(outdir, "ruby-00.png"))
    with open(os.path.join(outdir, "ruby-00.truth.json"), "w") as f:
        json.dump(truth, f, indent=1)
    print("written", os.path.join(outdir, "ruby-00.png"))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
