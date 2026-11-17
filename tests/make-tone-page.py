"""A procedural, IP-free page of the erasing cases 2.11 got wrong on real chapters, for the
eraser tests (2.12.0): lettering with a white outline on screentone bubbles, on a gradient
bubble, in a white bubble with letters close to its outline, and as narration on hatching.

  python3 make-tone-page.py <outdir>

Writes <outdir>/tone-00.png and tone-00.truth.json: per text area, its box (the bubble, or the
narration's panel area), the lettering's box, the glyph height, and the surface under it.
Needs Pillow and DejaVu Sans Bold.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

FONT = next((p for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"] if os.path.exists(p)), None)
if not FONT:
    sys.exit("No DejaVu Sans Bold found (install fonts-dejavu-core)")

W, H = 1200, 1700


def screentone(d, box, pitch=7, r=1.6, fill=(120, 120, 120), ground=(214, 214, 214)):
    x0, y0, x1, y1 = box
    d.rectangle(box, fill=ground)
    for y in range(y0 + 2, y1, pitch):
        off = (pitch // 2) if ((y - y0) // pitch) % 2 else 0
        for x in range(x0 + 2 + off, x1, pitch):
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def outlined(d, xy, text, font, fill="black", stroke="white", width=5):
    d.multiline_text(xy, text, font=font, fill=fill, stroke_width=width, stroke_fill=stroke, align="center", spacing=8)
    return d.multiline_textbbox(xy, text, font=font, stroke_width=width, align="center", spacing=8)


def main(outdir):
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, 34)
    truth = []
    panels = [(40, 40, 1160, 820), (40, 850, 1160, 1660)]
    for p in panels:
        d.rectangle(p, outline="black", width=6)
    # panel 1: hatching behind everything, so toned bubbles sit on art
    for x in range(60, 1150, 14):
        d.line([(x, 60), (x - 120, 800)], fill=(70, 70, 70), width=2)

    # 1. a toned (screentone) bubble with outlined lettering
    b = (90, 100, 560, 470)
    mask = Image.new("L", (W, H), 0); ImageDraw.Draw(mask).ellipse(b, fill=255)
    tone = Image.new("RGB", (W, H)); screentone(ImageDraw.Draw(tone), b)
    img.paste(tone, (0, 0), mask)
    d.ellipse(b, outline="black", width=5)
    lb = outlined(d, (190, 220), "IT'S TIME TO\nCOUNT YOUR\nSINS!", font)
    truth.append({"box": [b[0], b[1], b[2] - b[0], b[3] - b[1]], "lettering": [lb[0], lb[1], lb[2] - lb[0], lb[3] - lb[1]], "glyph": 26, "surface": "tone", "kind": "bubble"})

    # 2. a gradient bubble (light at the top, grey at the bottom)
    b = (640, 120, 1100, 500)
    grad = Image.new("RGB", (W, H))
    gd = ImageDraw.Draw(grad)
    for y in range(b[1], b[3]):
        v = int(245 - 90 * (y - b[1]) / (b[3] - b[1]))
        gd.line([(b[0], y), (b[2], y)], fill=(v, v, v))
    mask = Image.new("L", (W, H), 0); ImageDraw.Draw(mask).ellipse(b, fill=255)
    img.paste(grad, (0, 0), mask)
    d.ellipse(b, outline="black", width=5)
    lb = outlined(d, (730, 240), "SO THAT'S THE\nMONSTER FROM\nTHAT DAY?!", font)
    truth.append({"box": [b[0], b[1], b[2] - b[0], b[3] - b[1]], "lettering": [lb[0], lb[1], lb[2] - lb[0], lb[3] - lb[1]], "glyph": 26, "surface": "gradient", "kind": "bubble"})

    # 3. a white bubble whose lettering nearly touches its outline, with dot leaders
    b = (120, 540, 520, 790)
    d.ellipse(b, fill="white", outline="black", width=5)
    lb = d.multiline_textbbox((168, 618), "WAIT... THAT\nCAN'T BE...", font=font, align="center", spacing=8)
    d.multiline_text((168, 618), "WAIT... THAT\nCAN'T BE...", font=font, fill="black", align="center", spacing=8)
    truth.append({"box": [b[0], b[1], b[2] - b[0], b[3] - b[1]], "lettering": [lb[0], lb[1], lb[2] - lb[0], lb[3] - lb[1]], "glyph": 26, "surface": "white", "kind": "bubble"})

    # panel 2: a screentone sky and narration in white-outlined lettering straight on it
    screentone(d, (46, 856, 1154, 1654), pitch=6, r=1.3)
    for x in range(60, 1150, 40):
        d.line([(x, 1300), (x + 30, 1640)], fill=(40, 40, 40), width=3)
    lb = outlined(d, (360, 960), "MEANWHILE, FAR\nAWAY FROM THE CITY...", font)
    truth.append({"box": [lb[0] - 20, lb[1] - 20, lb[2] - lb[0] + 40, lb[3] - lb[1] + 40], "lettering": [lb[0], lb[1], lb[2] - lb[0], lb[3] - lb[1]], "glyph": 26, "surface": "tone", "kind": "narration"})

    img.save(os.path.join(outdir, "tone-00.png"))
    with open(os.path.join(outdir, "tone-00.truth.json"), "w") as f:
        json.dump(truth, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
