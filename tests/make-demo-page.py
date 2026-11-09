"""Generate an original, IP-free demo manga page for screenshots and fixtures.

Simple panels, shape-based characters and real speech bubbles with Spanish
text, so the translation engine has something genuine to detect and typeset.
Output: fixtures/demo-page.png (1200x1700) and fixtures/demo-items.json.
"""
import json, math, random, sys
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 1700
random.seed(7)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)

def halftone(box, spacing=9, r=2.2, color=(70, 70, 70)):
    x0, y0, x1, y1 = box
    for y in range(y0, y1, spacing):
        for x in range(x0 + (spacing // 2 if (y // spacing) % 2 else 0), x1, spacing):
            d.ellipse([x - r, y - r, x + r, y + r], fill=color)

def panel(box, tone=True):
    d.rectangle(box, outline="black", width=6)
    if tone:
        halftone((box[0] + 8, box[1] + 8, box[2] - 8, box[3] - 8), spacing=6, r=1.1, color=(120, 120, 120))

def character(cx, cy, s, dark=False):
    skin = (40, 40, 40) if dark else "white"
    d.ellipse([cx - s, cy - s * 1.2, cx + s, cy + s * 0.9], fill=skin, outline="black", width=5)  # head
    d.polygon([(cx - s * 1.1, cy - s * 0.6), (cx, cy - s * 1.9), (cx + s * 1.2, cy - s * 0.5), (cx + s * 0.6, cy - s * 1.2), (cx - s * 0.3, cy - s * 1.4)], fill="black")  # hair
    d.rectangle([cx - s * 1.4, cy + s * 0.9, cx + s * 1.4, cy + s * 3.2], fill=(30, 30, 30) if not dark else "white", outline="black", width=5)  # torso
    d.ellipse([cx - s * 0.5, cy - s * 0.3, cx - s * 0.2, cy + s * 0.1], fill="black" if not dark else "white")
    d.ellipse([cx + s * 0.2, cy - s * 0.3, cx + s * 0.5, cy + s * 0.1], fill="black" if not dark else "white")

truth = []  # ground-truth text regions: {"box":[x,y,w,h], "kind":"bubble"|"block", "items":[item indices]}

def bubble(cx, cy, rx, ry, text, size=30, tail=None, jagged=False):
    truth.append({"box": [round(cx - rx), round(cy - ry), round(2 * rx), round(2 * ry)], "kind": "bubble", "shape": "jagged" if jagged else "ellipse", "items": [len(items)]})
    if jagged:
        pts = []
        n = 28
        for i in range(n):
            a = 2 * math.pi * i / n
            k = 1.0 if i % 2 == 0 else 0.82
            pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
        d.polygon(pts, fill="white", outline="black")
        d.line(pts + [pts[0]], fill="black", width=5)
    else:
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill="white", outline="black", width=5)
        if tail:
            tx, ty = tail
            d.polygon([(cx - rx * 0.2, cy + ry * 0.85), (cx + rx * 0.25, cy + ry * 0.85), (tx, ty)], fill="white", outline="black")
            d.line([(cx - rx * 0.2, cy + ry * 0.9), (tx, ty), (cx + rx * 0.25, cy + ry * 0.9)], fill="black", width=5)
            d.rectangle([cx - rx * 0.2 + 3, cy + ry * 0.75, cx + rx * 0.25 - 3, cy + ry * 0.95], fill="white")
    f = ImageFont.truetype(FONT, size)
    lines = text.split("\n")
    lh = size * 1.15
    y = cy - lh * len(lines) / 2 + lh / 2
    for ln in lines:
        w = d.textlength(ln, font=f)
        d.text((cx - w / 2, y - size / 2), ln, font=f, fill="black")
        y += lh
    # text box in px for the mock model response
    tw = max(d.textlength(ln, font=f) for ln in lines)
    return [round(cx - tw / 2), round(cy - lh * len(lines) / 2), round(tw), round(lh * len(lines))]

items = []
# Panel 1: wide top
panel((40, 40, 1160, 620))
character(380, 330, 70)
character(820, 360, 60, dark=True)
items.append({"box": bubble(230, 160, 170, 95, "¡NO PUEDE\nSER!", 34, tail=(340, 270), jagged=True), "text": "It can't be!", "size": "large"})
items.append({"box": bubble(960, 170, 170, 90, "Tranquilo.\nTodavía no ha\nterminado.", 26, tail=(860, 290)), "text": "Calm down. It isn't over yet.", "size": "normal"})
# Panel 2: left
panel((40, 660, 590, 1180))
character(300, 980, 80)
items.append({"box": bubble(300, 790, 220, 95, "¿Desde cuándo\nlo sabías?", 28, tail=(300, 900)), "text": "Since when did you know?", "size": "normal"})
# Panel 3: right
panel((630, 660, 1160, 1180))
character(900, 960, 75, dark=True)
items.append({"box": bubble(900, 790, 200, 85, "Desde el\nprincipio.", 30, tail=(900, 890)), "text": "From the very beginning.", "size": "normal"})
# Panel 4: bottom wide, narration box + whisper
panel((40, 1220, 1160, 1660))
d.rectangle([70, 1250, 470, 1330], fill="white", outline="black", width=5)
f = ImageFont.truetype(FONT, 24)
d.text((90, 1270), "Tres horas después...", font=f, fill="black")
truth.append({"box": [70, 1250, 400, 80], "kind": "bubble", "shape": "rect", "items": [len(items)]})
items.append({"box": [90, 1270, 300, 30], "text": "Three hours later...", "size": "small", "kind": "narration"})
# free narration straight on the halftone (no box): a text block the engine must inpaint
d.text((620, 1250), "Mientras tanto, en la ciudad...", font=f, fill="black")
tw = d.textlength("Mientras tanto, en la ciudad...", font=f)
truth.append({"box": [620, 1250, round(tw), 30], "kind": "block", "items": [len(items)]})
items.append({"box": [620, 1250, round(tw), 30], "text": "Meanwhile, in the city...", "size": "small", "kind": "narration"})
character(600, 1480, 85)
# joined bubble: two overlapping ellipses sharing one outline (two speakers)
d.ellipse([760, 1300, 1120, 1450], fill="white", outline="black", width=5)
d.ellipse([820, 1420, 1140, 1560], fill="white", outline="black", width=5)
d.ellipse([826, 1426, 1134, 1554], fill="white")  # erase the inner outline where they overlap
d.ellipse([766, 1306, 1114, 1444], fill="white")
f2 = ImageFont.truetype(FONT, 26)
d.text((850, 1350), "¿Y si no vuelve?", font=f2, fill="black")
d.text((870, 1470), "Volverá.", font=f2, fill="black")
truth.append({"box": [760, 1300, 380, 260], "kind": "bubble", "shape": "joined", "items": [len(items), len(items) + 1]})
items.append({"box": [850, 1350, 210, 30], "text": "And if he doesn't come back?", "size": "normal"})
items.append({"box": [870, 1470, 110, 30], "text": "He will.", "size": "normal"})

out = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
import os; os.makedirs(out, exist_ok=True)
img.save(f"{out}/demo-page.png")
json.dump([{"tag": None, "kind": it.get("kind", "bubble"), **it} for it in items], open(f"{out}/demo-items.json", "w"), indent=2)
json.dump(truth, open(f"{out}/demo-truth.json", "w"), indent=2)
print("demo page written", W, H, len(items), "items")
