"""Procedural, IP-free test pages with ground truth for the engine tests.

Each page: a grid of panels (toned or plain), shape characters, and text in
several forms the engine must handle — Latin bubbles (ellipse / jagged /
rounded caption), Japanese vertical bubbles and horizontal captions, dark
bubbles with white lettering, free narration straight on the tone, and large
sound effects that must be ignored. Deterministic per seed.

  python3 make-pages.py <outdir> [count=8]

Writes <outdir>/gen-NN.png, gen-NN.truth.json ({box, kind, items, lang}) and
gen-NN.items.json (the "model answer": text per truth item, tags filled by the
test from the detected regions).
"""
import json, math, os, random, sys
from PIL import Image, ImageDraw, ImageFont

LATIN = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
CJK_CANDIDATES = ["/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"]
CJK = next((p for p in CJK_CANDIDATES if os.path.exists(p)), None)

ES = ["¡No puede ser!", "Tranquilo, todavía no ha terminado.", "¿Desde cuándo lo sabías?", "Desde el principio.", "Tres horas después...",
      "¿Y si no vuelve?", "Volverá.", "Mientras tanto, en la ciudad...", "No te muevas.", "Esto no ha acabado.", "¿Quién eres tú?", "Vámonos ya."]
IT = ["Non può essere!", "Calmati, non è ancora finita.", "Da quando lo sapevi?", "Dall'inizio.", "Tre ore dopo...", "E se non torna?", "Tornerà.",
      "Nel frattempo, in città...", "Non muoverti.", "Chi sei tu?", "Andiamo via."]
JA = ["そんなはずはない", "待ってくれ", "話を聞け", "三時間後", "どういうことだ", "まだ終わっていない", "行くぞ", "誰だお前は", "その頃、街では", "動くな"]
EN = ["It can't be!", "Calm down, it isn't over yet.", "Since when did you know?", "From the very beginning.", "Three hours later...",
      "And if he doesn't come back?", "He will.", "Meanwhile, in the city...", "Don't move.", "This isn't over.", "Who are you?", "Let's go."]
SFX = ["BOOM", "CRASH", "ドン", "ゴゴゴ", "WHAM"]


def main(outdir, count):
    os.makedirs(outdir, exist_ok=True)
    for n in range(count):
        page = Page(seed=100 + n)
        page.build()
        page.save(outdir, f"gen-{n:02d}")
    print(f"{count} pages written to {outdir}")


class Page:
    def __init__(self, seed):
        self.rng = random.Random(seed)
        self.W, self.H = 1200, 1700
        self.img = Image.new("RGB", (self.W, self.H), "white")
        self.d = ImageDraw.Draw(self.img)
        self.truth, self.items = [], []
        self.occupied = []  # boxes already used inside the current panel

    # ---------- drawing helpers ----------
    def halftone(self, box, spacing, r, color):
        x0, y0, x1, y1 = box
        for y in range(y0, y1, spacing):
            off = spacing // 2 if (y // spacing) % 2 else 0
            for x in range(x0 + off, x1, spacing):
                self.d.ellipse([x - r, y - r, x + r, y + r], fill=color)

    def character(self, cx, cy, s, dark):
        d = self.d
        skin = (40, 40, 40) if dark else "white"
        d.ellipse([cx - s, cy - s * 1.2, cx + s, cy + s * 0.9], fill=skin, outline="black", width=5)
        d.polygon([(cx - s * 1.1, cy - s * 0.6), (cx, cy - s * 1.9), (cx + s * 1.2, cy - s * 0.5), (cx + s * 0.6, cy - s * 1.2), (cx - s * 0.3, cy - s * 1.4)], fill="black")
        d.rectangle([cx - s * 1.4, cy + s * 0.9, cx + s * 1.4, cy + s * 3.2], fill=(30, 30, 30) if not dark else "white", outline="black", width=5)
        eye = "black" if not dark else "white"
        d.ellipse([cx - s * 0.5, cy - s * 0.3, cx - s * 0.2, cy + s * 0.1], fill=eye)
        d.ellipse([cx + s * 0.2, cy - s * 0.3, cx + s * 0.5, cy + s * 0.1], fill=eye)

    def free(self, box, margin=14):
        x0, y0, x1, y1 = box
        for ox0, oy0, ox1, oy1 in self.occupied:
            if x0 < ox1 + margin and x1 > ox0 - margin and y0 < oy1 + margin and y1 > oy0 - margin:
                return False
        return True

    # ---------- text ----------
    def h_lines(self, text, font, maxw):
        words, lines, cur = text.split(), [], ""
        for w in words:
            t = (cur + " " + w).strip()
            if self.d.textlength(t, font=font) <= maxw or not cur: cur = t
            else: lines.append(cur); cur = w
        if cur: lines.append(cur)
        return lines

    def draw_h(self, cx, cy, text, font, fill, maxw):
        lines = self.h_lines(text, font, maxw)
        lh = font.size * 1.15
        y = cy - lh * len(lines) / 2
        tw = 0
        for ln in lines:
            w = self.d.textlength(ln, font=font); tw = max(tw, w)
            self.d.text((cx - w / 2, y + (lh - font.size) / 2), ln, font=font, fill=fill)
            y += lh
        return [round(cx - tw / 2), round(cy - lh * len(lines) / 2), round(tw), round(lh * len(lines))]

    def draw_v(self, cx, cy, text, font, fill, maxh):
        # vertical Japanese: columns right-to-left, characters top-to-bottom
        per = max(1, int(maxh // (font.size * 1.08)))
        cols = [text[i:i + per] for i in range(0, len(text), per)]
        colw = font.size * 1.35
        x = cx + colw * (len(cols) - 1) / 2
        th = max(len(c) for c in cols) * font.size * 1.08
        for col in cols:
            y = cy - th / 2
            for ch in col:
                self.d.text((x - font.size / 2, y), ch, font=font, fill=fill)
                y += font.size * 1.08
            x -= colw
        tw = colw * len(cols)
        return [round(cx - tw / 2), round(cy - th / 2), round(tw), round(th)]

    # ---------- regions ----------
    def bubble(self, cx, cy, rx, ry, lang, dark=False, shape="ellipse"):
        d, rng = self.d, self.rng
        fill = "black" if dark else "white"
        ink = "white" if dark else "black"
        if shape == "jagged":
            pts = []
            n = rng.choice([22, 28, 34])
            for i in range(n):
                a = 2 * math.pi * i / n
                k = 1.0 if i % 2 == 0 else rng.uniform(0.78, 0.86)
                pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
            d.polygon(pts, fill=fill, outline="black")
            d.line(pts + [pts[0]], fill="black", width=5)
            inner = 0.72
        elif shape == "rect":
            d.rounded_rectangle([cx - rx, cy - ry, cx + rx, cy + ry], radius=12, fill=fill, outline="black", width=5)
            inner = 0.86
        else:
            d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill, outline="black", width=5)
            inner = 0.74
        kind_items = [len(self.items)]
        if lang == "ja" and CJK:
            size = rng.choice([26, 30, 34])
            font = ImageFont.truetype(CJK, size, index=0)
            text = rng.choice(JA)
            tb = self.draw_v(cx, cy, text, font, ink, ry * 2 * inner) if ry > rx * 1.1 else self.draw_h(cx, cy, text, font, ink, rx * 2 * inner)
        else:
            size = rng.choice([22, 26, 30, 34])
            font = ImageFont.truetype(LATIN, size)
            i = rng.randrange(len(ES))
            text = (ES if lang == "es" else IT)[i % (len(ES) if lang == "es" else len(IT))]
            tb = self.draw_h(cx, cy, text, font, ink, rx * 2 * inner)
        self.truth.append({"box": [round(cx - rx), round(cy - ry), round(2 * rx), round(2 * ry)], "kind": "bubble", "shape": shape, "items": kind_items, "lang": lang, "dark": dark})
        self.items.append({"box": tb, "text": EN[len(self.items) % len(EN)], "size": "normal", "kind": "bubble"})
        self.occupied.append((cx - rx, cy - ry, cx + rx, cy + ry))

    def caption(self, x, y, w, lang):
        rng = self.rng
        if lang == "ja" and CJK:
            font = ImageFont.truetype(CJK, 28, index=0); text = rng.choice(JA)
        else:
            font = ImageFont.truetype(LATIN, rng.choice([22, 24, 26])); text = rng.choice(ES if lang == "es" else IT)
        h = font.size * 2.6
        self.d.rectangle([x, y, x + w, y + h], fill="white", outline="black", width=5)
        tb = self.draw_h(x + w / 2, y + h / 2, text, font, "black", w * 0.9)
        self.truth.append({"box": [x, y, w, round(h)], "kind": "bubble", "shape": "rect", "items": [len(self.items)], "lang": lang, "dark": False})
        self.items.append({"box": tb, "text": EN[len(self.items) % len(EN)], "size": "small", "kind": "narration"})
        self.occupied.append((x, y, x + w, y + h))

    def free_text(self, x, y, lang, maxw):
        rng = self.rng
        if lang == "ja" and CJK:
            font = ImageFont.truetype(CJK, 26, index=0); text = rng.choice(JA)
        else:
            font = ImageFont.truetype(LATIN, rng.choice([22, 24])); text = rng.choice(ES if lang == "es" else IT)
        tb = self.draw_h(x + maxw / 2, y + font.size, text, font, "black", maxw)
        self.truth.append({"box": tb, "kind": "block", "items": [len(self.items)], "lang": lang, "dark": False})
        self.items.append({"box": tb, "text": EN[len(self.items) % len(EN)], "size": "small", "kind": "narration"})
        self.occupied.append((tb[0], tb[1], tb[0] + tb[2], tb[1] + tb[3]))

    def sfx(self, x, y):
        text = self.rng.choice(SFX)
        if any(ord(c) > 0x2000 for c in text):
            if not CJK: return
            font = ImageFont.truetype(CJK, 120, index=0)
        else:
            font = ImageFont.truetype(LATIN, 110)
        self.d.text((x, y), text, font=font, fill="black")
        w = self.d.textlength(text, font=font)
        self.occupied.append((x, y, x + w, y + 130))

    # ---------- page ----------
    def build(self):
        rng = self.rng
        lang = rng.choice(["es", "it", "ja"] if CJK else ["es", "it"])
        self.lang = lang
        rows = rng.choice([2, 3])
        y = 40
        row_h = (self.H - 80 - 40 * (rows - 1)) // rows
        for r in range(rows):
            cols = rng.choice([1, 2, 2, 3]) if rows == 3 else rng.choice([1, 2, 2])
            x = 40
            col_w = (self.W - 80 - 40 * (cols - 1)) // cols
            for c in range(cols):
                self.panel((x, y, x + col_w, y + row_h), lang)
                x += col_w + 40
            y += row_h + 40

    def panel(self, box, lang):
        rng, d = self.rng, self.d
        x0, y0, x1, y1 = box
        self.occupied = []
        d.rectangle(box, outline="black", width=6)
        tone = rng.random() < 0.7
        if tone:
            self.halftone((x0 + 8, y0 + 8, x1 - 8, y1 - 8), spacing=rng.choice([9, 11, 13]), r=rng.choice([1.8, 2.0, 2.4]), color=rng.choice([(110, 110, 110), (130, 130, 130), (90, 90, 90)]))
        w, h = x1 - x0, y1 - y0
        # a character low in the panel
        if rng.random() < 0.8 and h > 300:
            s = rng.choice([55, 65, 80])
            cx = rng.uniform(x0 + s * 1.6, x1 - s * 1.6); cy = y1 - s * 3.4
            self.character(cx, cy, s, dark=rng.random() < 0.4)
            self.occupied.append((cx - s * 1.5, cy - s * 2, cx + s * 1.5, y1))
        # bubbles in the upper part
        n_b = rng.choice([1, 1, 2, 2, 3]) if w > 500 else rng.choice([1, 1, 2])
        for _ in range(n_b):
            for _try in range(30):
                vertical = lang == "ja" and rng.random() < 0.7
                rx = rng.uniform(70, 150) if vertical else rng.uniform(110, min(230, w * 0.4))
                ry = rng.uniform(160, min(280, h * 0.42)) if vertical else rng.uniform(70, 120)
                cx = rng.uniform(x0 + rx + 20, x1 - rx - 20); cy = rng.uniform(y0 + ry + 20, y0 + h * 0.6)
                if cx - rx < x0 + 12 or cx + rx > x1 - 12 or cy + ry > y1 - 12: continue
                if self.free((cx - rx, cy - ry, cx + rx, cy + ry)):
                    shape = rng.choice(["ellipse", "ellipse", "ellipse", "jagged", "rect"])
                    self.bubble(cx, cy, rx, ry, lang, dark=rng.random() < 0.2, shape=shape)
                    break
        # caption box in a corner
        if rng.random() < 0.5 and w > 400:
            cw = rng.randint(260, min(460, w - 60))
            cx0 = x0 + 30 if rng.random() < 0.5 else x1 - 30 - cw
            cy0 = y0 + 30
            if self.free((cx0, cy0, cx0 + cw, cy0 + 70)): self.caption(cx0, cy0, cw, lang)
        # free narration on the tone
        if tone and rng.random() < 0.4 and w > 500:
            fx = x0 + 40; fy = y0 + h * 0.62
            if self.free((fx, fy, fx + 360, fy + 40)): self.free_text(fx, fy, lang, 360)
        # sound effect to be ignored
        if rng.random() < 0.3 and w > 500 and h > 450:
            sx = x0 + 40 + rng.uniform(0, w - 400); sy = y0 + h * 0.45
            if self.free((sx, sy, sx + 330, sy + 130), margin=30): self.sfx(sx, sy)

    def save(self, outdir, name):
        self.img.save(f"{outdir}/{name}.png")
        json.dump(self.truth, open(f"{outdir}/{name}.truth.json", "w"), indent=1, ensure_ascii=False)
        json.dump([{"tag": None, **it} for it in self.items], open(f"{outdir}/{name}.items.json", "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fixtures", int(sys.argv[2]) if len(sys.argv) > 2 else 8)
