// Generated pages with exact answers, in every script the app reads: Japanese and Chinese in
// vertical columns, Korean, Latin (English, Spanish, Portuguese, Vietnamese accents). Each page
// is drawn twice: `truth` (art, bubbles, sound effects, lines left as drawn) and `input` (truth +
// the lettering to translate), so what the eraser should leave is known pixel for pixel, as are
// every bubble's inside and outline and every line's letter size. Seeded: page n is always the same.
//   import { makePage } from "./synth.mjs"; const p = makePage(seed);
import { createCanvas } from "canvas";

export const SCRIPTS = ["ja", "ja", "zh", "ko", "en", "es", "pt", "vi"];

const POOL = {
  ja: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモラリルレロワンガギグゲゴダデドバビブベボ私何今日本人大中小上下手目口心気言思見行来出入時間前後自分事力生学話待終誰街動",
  zh: "你我他她是的不了在有这个们来说吗什么怎么样真好吧没想要去会能看知道事情现在时候还就都很大小人心里出这那哪谁为",
  ko: "안녕하세요그래뭐야정말왜이렇게너는나도알아괜찮아지금여기어디가자우리같이빨리기다려잠깐무슨일이야진짜고마워미안해",
};
const WORDS = {
  en: "WHAT ARE YOU DOING HERE I CAN'T BELIEVE IT WAIT FOR ME LET'S GO NOW THIS ISN'T OVER YET WHO ARE YOU DON'T MOVE HE WILL COME BACK".split(" "),
  es: "¿QUÉ ESTÁS HACIENDO AQUÍ? ¡NO PUEDE SER! ESPÉRAME VÁMONOS YA ESTO NO HA ACABADO ¿QUIÉN ERES TÚ? NO TE MUEVAS VOLVERÁ MAÑANA".split(" "),
  pt: "O QUE VOCÊ ESTÁ FAZENDO AQUI? NÃO PODE SER! ESPERA AÍ VAMOS EMBORA ISSO NÃO ACABOU QUEM É VOCÊ? NÃO SE MEXA AÇÃO CORAÇÃO".split(" "),
  vi: "CẬU ĐANG LÀM GÌ Ở ĐÂY? KHÔNG THỂ NÀO! ĐỢI TÔI VỚI ĐI THÔI CHUYỆN NÀY CHƯA XONG ĐÂU CẬU LÀ AI? ĐỪNG CỬ ĐỘNG".split(" "),
};
const EN_OUT = "you what is this the a to I it me that we are not no do have be so just know can get here there now go come all well right then why how really sorry wait yes okay look think want going something nothing never always again still too".split(" ");
const LATIN_FONTS = ["DejaVu Sans", "FreeSans", "Inter", "Carlito", "Gytakusub Comic Relief", "Gytakusub Mali"];
const CJK_FONTS = { ja: ["Noto Sans CJK JP", "Noto Serif CJK JP", "IPAGothic"], zh: ["Noto Sans CJK SC", "Noto Serif CJK SC"], ko: ["Noto Sans CJK KR", "Noto Serif CJK KR"] };

function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (a) => a[Math.floor(r() * a.length)];
  r.range = (lo, hi) => lo + r() * (hi - lo);
  return r;
}

const W = 1000, H = 1420;

/**
 * One page: { W, H, script, input, truth, bubbles: [{id, box, inside, outline}], blocks: [...] }
 * opts.printed: also lettering that real chapters showed the bench lacked (a debug report, 2.14.2):
 * text printed on an object in the art (a sheet of paper, a label, a book cover), tilted, sometimes
 * white on a dark emblem for part of the line; and free text set at a slant. Drawn from a random
 * stream of their own, so a seed's other blocks stay as they were without it.
 * opts.readers: also bubble shapes the owner's chapters showed the bench lacked (a debug report,
 * 2.15), where translations ran out of their bubble: two caption boxes, one laid over the corner of
 * the other; a bubble of two lobes, one speaker each, set diagonally; a bubble with straight slanted
 * sides, its lines set along the slant; a narrow bubble with a line broken into short rows. Also
 * from a stream of their own.
 * opts.webtoon: also what the owner's Naver episode showed the bench lacked (debug reports, 2.15):
 * dark bubbles, filled with a gradient from near black to a deep colour, with a coloured outline and
 * red or white lettering; and a bubble cut by the image's top or bottom edge, as a webtoon episode
 * served in several images cuts one (white or dark). Also from a stream of their own.
 * opts.cutLettering: bubbles the image's top or bottom edge cuts at their lettering, through its
 * nearest row or just short of it (the owner's real run of 3.2 with the learned mask, a debug
 * report: letters left where the cut ran by them), white or dark. Also from a stream of their own.
 */
export function makePage(seed, opts = {}) {
  const r = rng(seed * 7919 + 17);
  const script = SCRIPTS[seed % SCRIPTS.length];
  const colour = r() < 0.15;
  const vertical = (script === "ja" || script === "zh") && r() < 0.85;
  const truth = createCanvas(W, H), t = truth.getContext("2d");
  t.fillStyle = "#fff"; t.fillRect(0, 0, W, H);
  // ---- panels and art ----
  const panels = [];
  const rows = r.int(2, 4);
  let y = 30;
  for (let i = 0; i < rows; i++) {
    const h = i === rows - 1 ? H - 30 - y : Math.round(r.range(0.6, 1.4) * (H - 60) / rows);
    const cols = r.int(1, 3);
    let x = 30;
    for (let j = 0; j < cols; j++) {
      const w = j === cols - 1 ? W - 30 - x : Math.round(r.range(0.6, 1.4) * (W - 60) / cols);
      if (w > 120 && h > 120) panels.push({ x: x + 6, y: y + 6, w: w - 12, h: h - 12 });
      x += w;
    }
    y += h;
  }
  for (const p of panels) art(t, p, r, colour);
  // ---- lettering: blocks, each in a bubble, a caption box, or free over the art ----
  const bubbles = [], blocks = [], kept = [], occupied = [];
  const ink = createCanvas(W, H), k = ink.getContext("2d"); // the lettering to translate, alone
  for (const p of panels) {
    const n = r.int(0, p.w * p.h > 250000 ? 3 : 2);
    for (let i = 0; i < n; i++) {
      const kind = r() < 0.72 ? "bubble" : r() < 0.5 ? "narration" : "free";
      const size = Math.round(vertical ? r.range(16, 32) : r.range(12, 26) * (script === "ko" ? 1.1 : 1));
      const two = kind === "bubble" && r() < 0.18; // two speakers in one bubble
      const lay = [lettering(r, script, vertical, size, kind)];
      if (two) lay.push(lettering(r, script, vertical, size, kind));
      const gap = size * 1.2;
      const bw = vertical && two ? lay[0].w + lay[1].w + gap : Math.max(...lay.map((l) => l.w)), bh = vertical && two ? Math.max(lay[0].h, lay[1].h) : lay.reduce((s, l) => s + l.h, 0) + (two ? gap : 0);
      const shape = kind === "bubble" ? r.pick(["ellipse", "ellipse", "round", "cloud", "burst", "tall"]) : "box";
      const k1 = shape === "round" || shape === "box" ? 1.18 : shape === "burst" ? 1.75 : 1.5;
      const bwFull = bw * k1 + size, bhFull = bh * (shape === "tall" ? 1.3 : k1) + size;
      if (bwFull > p.w - 10 || bhFull > p.h - 10) continue;
      let spot = null;
      for (let tries = 0; tries < 25 && !spot; tries++) {
        const cand = { x: p.x + r.range(5, p.w - bwFull - 5), y: p.y + r.range(5, p.h - bhFull - 5), w: bwFull, h: bhFull };
        if (!occupied.some((o) => overlaps(o, cand, 8))) spot = cand;
      }
      if (!spot) continue;
      occupied.push(spot);
      const cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2;
      let bubble = null;
      if (kind !== "free") {
        const lw = r.range(1.5, 4);
        bubble = shapeOf(r, shape, spot, lw);
        drawShape(t, bubble, colour && r() < 0.3 ? r.pick(["#fff7d6", "#e8f4ff"]) : "#fff", "#111");
        bubble.id = bubbles.length + 1; bubble.kind = kind;
        bubble.inside = maskOf(bubble, "inside"); bubble.outline = maskOf(bubble, "outline");
        bubbles.push(bubble);
      }
      // the blocks: centred, or side by side (vertical) / stacked (horizontal) for two speakers
      const places = lay.length === 1 ? [{ x: cx - lay[0].w / 2, y: cy - lay[0].h / 2 }]
        : vertical ? [{ x: cx + gap / 2, y: cy - lay[0].h / 2 }, { x: cx - gap / 2 - lay[1].w, y: cy - lay[1].h / 2 }]
        : [{ x: cx - lay[0].w / 2, y: cy - bh / 2 }, { x: cx - lay[1].w / 2, y: cy - bh / 2 + lay[0].h + gap }];
      const color = colour && r() < 0.35 ? r.pick(["#1d3fa6", "#b3161b", "#1b6b2a"]) : "#111";
      lay.forEach((l, j) => {
        const at = places[j];
        const marks = r() < 0.06; // a line of only "……" / "!?": stays as drawn
        if (marks) { l = lettering(r, script, vertical, size, kind, true); }
        const target = marks ? t : k;
        const box = drawLettering(target, l, at.x, at.y, color, kind === "free");
        if (marks) { kept.push({ box, text: l.text }); return; }
        blocks.push({ id: blocks.length, kind, script, vertical: l.vertical, letter: l.letter, size: l.size, box, text: l.text, bubble: bubble ? bubble.id : null, two, shape });
      });
    }
  }
  const ink2 = createCanvas(W, H), k2 = ink2.getContext("2d"); // printed lettering (light glyphs count too)
  if (opts.printed) printed(rng(seed * 104729 + 3), { t, k, k2, panels, occupied, blocks, script, vertical, colour });
  if (opts.readers) readers(rng(seed * 7727 + 5), { t, k, panels, occupied, bubbles, blocks, script, vertical, colour });
  if (opts.webtoon) webtoon(rng(seed * 6553 + 11), { t, k, panels, occupied, bubbles, blocks, script, vertical });
  if (opts.cutLettering) webtoon(rng(seed * 4099 + 7), { t, k, panels, occupied, bubbles, blocks, script, vertical }, true);
  // a sound effect over the art (stays as drawn), on a third of the pages
  const sfx = [];
  if (r() < 0.33 && panels.length) {
    const p = r.pick(panels), s = Math.round(r.range(50, 110));
    const text = script === "ja" || script === "zh" ? r.pick(["ドン", "ゴゴゴ", "バン", "ザッ"]) : script === "ko" ? r.pick(["쾅", "두근", "휙"]) : r.pick(["BOOM", "CRASH", "WHAM", "BAM"]);
    t.save(); t.translate(p.x + p.w * r.range(0.2, 0.8), p.y + p.h * r.range(0.3, 0.8)); t.rotate(r.range(-0.4, 0.4));
    t.font = `bold ${s}px "${CJK_FONTS.ja[0]}"`; t.lineWidth = s * 0.12; t.strokeStyle = "#fff"; t.strokeText(text, 0, 0); t.fillStyle = "#111"; t.fillText(text, 0, 0);
    t.restore();
    sfx.push({ text });
  }
  // input = truth + the lettering
  const input = createCanvas(W, H), ix = input.getContext("2d");
  ix.drawImage(truth, 0, 0); ix.drawImage(ink, 0, 0); ix.drawImage(ink2, 0, 0);
  const inkData = k.getImageData(0, 0, W, H).data, ink2Data = k2.getImageData(0, 0, W, H).data;
  for (const b of blocks) { // each block's pixels: its glyphs (core) and its whole footprint (halo too)
    const core = [], foot = [], d = b.printed ? ink2Data : inkData;
    const x0 = Math.max(0, Math.floor(b.box.x - 8)), y0 = Math.max(0, Math.floor(b.box.y - 8)), x1 = Math.min(W, Math.ceil(b.box.x + b.box.w + 8)), y1 = Math.min(H, Math.ceil(b.box.y + b.box.h + 8));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = yy * W + xx, a = d[q * 4 + 3]; if (a > 30) foot.push(q); if (a > 140 && (b.printed || d[q * 4] + d[q * 4 + 1] + d[q * 4 + 2] < 450)) core.push(q); }
    b.core = Int32Array.from(core); b.foot = Int32Array.from(foot);
  }
  return { W, H, seed, script, colour, input: ix.getImageData(0, 0, W, H), truth: t.getImageData(0, 0, W, H), bubbles, blocks, kept, sfx };
}

// ---------- lettering printed on things, and slanted free text (opts.printed) ----------
function printed(r, { t, k, k2, panels, occupied, blocks, script, vertical, colour }) {
  const rotBox = (cx, cy, w, h, a) => { const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), bw = w * c + h * s, bh = w * s + h * c; return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh }; };
  const spotFor = (p, w, h) => {
    for (let tries = 0; tries < 25; tries++) {
      const cand = { x: p.x + r.range(5, Math.max(6, p.w - w - 5)), y: p.y + r.range(5, Math.max(6, p.h - h - 5)), w, h };
      if (cand.x + w < p.x + p.w && cand.y + h < p.y + p.h && !occupied.some((o) => overlaps(o, cand, 8))) return cand;
    }
    return null;
  };
  const printOne = (p) => { // text printed on an object: a sheet, a label, a book cover
      const a = r() < 0.3 ? 0 : (r() < 0.5 ? -1 : 1) * r.range(0.05, 0.4);
      const size = Math.round(r.range(12, 24) * (vertical ? 1.1 : 1));
      const l = lettering(r, script, vertical && r() < 0.5, size, "sign");
      const pad = size * r.range(0.6, 1.2), ow = l.w + 2 * pad, oh = l.h + 2 * pad;
      const bb = rotBox(0, 0, ow, oh, a), spot = spotFor(p, bb.w, bb.h);
      if (!spot) return;
      occupied.push(spot);
      const cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2;
      // the object, in the art: light paper with a rule or two, its edge drawn
      t.save(); t.translate(cx, cy); t.rotate(a);
      t.fillStyle = colour && r() < 0.4 ? r.pick(["#f6ead2", "#e6eef8"]) : r.pick(["#fff", "#f4f1ea", "#ececec"]);
      t.fillRect(-ow / 2, -oh / 2, ow, oh); t.lineWidth = r.range(1, 2.5); t.strokeStyle = "#222"; t.strokeRect(-ow / 2, -oh / 2, ow, oh);
      t.strokeStyle = "#999"; t.lineWidth = 1;
      for (let i = 0, n = r.int(0, 3); i < n; i++) { const yy = -oh / 2 + r.range(0.1, 0.9) * oh; t.beginPath(); t.moveTo(-ow / 2 + 6, yy); t.lineTo(ow / 2 - 6, yy); t.stroke(); }
      // part of the line white on a dark emblem (a book title over a printed seal)
      const emblem = r() < 0.35 ? { x: -l.w / 2 - size * 0.3, y: -l.h / 2 - size * 0.3, w: l.w * r.range(0.3, 0.6) + size * 0.3, h: l.h + size * 0.6 } : null;
      if (emblem) { t.fillStyle = r.pick(["#222", "#3a3a3a", "#1d3f6a"]); t.beginPath(); t.ellipse(emblem.x + emblem.w / 2, emblem.y + emblem.h / 2, emblem.w / 2 + size * 0.2, emblem.h / 2, 0, 0, Math.PI * 2); t.fill(); }
      t.restore();
      for (const [c, col, clip] of [[k2, "#151515", null], ...(emblem ? [[k2, "#fff", emblem]] : [])]) {
        c.save(); c.translate(cx, cy); c.rotate(a);
        if (clip) { c.beginPath(); c.ellipse(clip.x + clip.w / 2, clip.y + clip.h / 2, clip.w / 2 + size * 0.2, clip.h / 2, 0, 0, Math.PI * 2); c.clip(); }
        drawLettering(c, l, -l.w / 2, -l.h / 2, col, false);
        c.restore();
      }
      blocks.push({ id: blocks.length, kind: "sign", script, vertical: l.vertical, letter: l.letter, size: l.size, box: rotBox(cx, cy, l.w, l.h, a), text: l.text, bubble: null, two: false, shape: "printed", printed: true, tilt: +a.toFixed(2), emblem: !!emblem });
  };
  const slantOne = (p) => { // free text over the art, at a slant
      const a = (r() < 0.5 ? -1 : 1) * r.range(0.1, 0.4);
      const size = Math.round(r.range(14, 28));
      const l = lettering(r, script, false, size, "free");
      const bb = rotBox(0, 0, l.w + size, l.h + size, a), spot = spotFor(p, bb.w, bb.h);
      if (!spot) return;
      occupied.push(spot);
      const cx = spot.x + spot.w / 2, cy = spot.y + spot.h / 2;
      k.save(); k.translate(cx, cy); k.rotate(a); drawLettering(k, l, -l.w / 2, -l.h / 2, "#111", true); k.restore();
      blocks.push({ id: blocks.length, kind: "free", script, vertical: false, letter: l.letter, size: l.size, box: rotBox(cx, cy, l.w, l.h, a), text: l.text, bubble: null, two: false, shape: "slanted", tilt: +a.toFixed(2) });
  };
  for (const p of panels) { if (r() < 0.5) printOne(p); if (r() < 0.35) slantOne(p); }
}

// ---------- bubble shapes from readers' chapters (opts.readers) ----------
function readers(r, { t, k, panels, occupied, bubbles, blocks, script, vertical, colour }) {
  const spotFor = (p, w, h) => {
    for (let tries = 0; tries < 25; tries++) {
      const cand = { x: p.x + r.range(5, Math.max(6, p.w - w - 5)), y: p.y + r.range(5, Math.max(6, p.h - h - 5)), w, h };
      if (cand.x + w < p.x + p.w - 4 && cand.y + h < p.y + p.h - 4 && !occupied.some((o) => overlaps(o, cand, 8))) return cand;
    }
    return null;
  };
  const fill = () => (colour && r() < 0.3 ? r.pick(["#fff7d6", "#e8f4ff"]) : "#fff");
  const ink = () => (colour && r() < 0.35 ? r.pick(["#1d3fa6", "#b3161b", "#1b6b2a"]) : "#111");
  const sizeOf = () => Math.round(vertical ? r.range(16, 30) : r.range(12, 24) * (script === "ko" ? 1.1 : 1));
  // a bubble of the page: its inside and outline from a drawing function, as maskOf does for a path
  const bubbleOf = (shape, box, lw, kind, inside, outline) => {
    const b = { box, lw, shape, kind, id: bubbles.length + 1, inside: maskFrom(inside), outline: maskFrom(outline) };
    bubbles.push(b); return b;
  };
  const block = (l, box, bubble, kind, shape, two) => blocks.push({ id: blocks.length, kind, script, vertical: l.vertical, letter: l.letter, size: l.size, box, text: l.text, bubble: bubble.id, two, shape });
  const rectPath = (c, b) => { c.beginPath(); c.rect(b.x, b.y, b.w, b.h); };
  const ellPath = (c, e) => { c.beginPath(); c.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2); };

  // Two caption boxes, the second laid over the lower corner of the first (its lettering clear of it)
  const captions = (p) => {
    const size = sizeOf(), m = size * 0.7, la = lettering(r, script, vertical, size, "narration"), lb = lettering(r, script, vertical, size, "narration");
    const right = r() < 0.5, A = { w: la.w + 2 * m, h: la.h + 2 * m + size * r.range(1.2, 2.2) }, B = { w: lb.w + 2 * m, h: lb.h + 2 * m };
    const dx = A.w * r.range(0.3, 0.6), dy = la.h + 2 * m + size * r.range(0.1, 0.5); // B's corner over A's empty lower part
    const W2 = Math.max(A.w, dx + B.w), H2 = Math.max(A.h, dy + B.h), spot = spotFor(p, W2, H2);
    if (!spot) return;
    occupied.push(spot);
    A.x = right ? spot.x : spot.x + W2 - A.w; A.y = spot.y;
    B.x = right ? A.x + dx : A.x + A.w - dx - B.w; B.y = A.y + dy;
    const lw = r.range(1.5, 3), fa = fill(), fb = fill();
    t.fillStyle = fa; t.fillRect(A.x, A.y, A.w, A.h); t.lineWidth = lw; t.strokeStyle = "#111"; t.strokeRect(A.x, A.y, A.w, A.h);
    t.fillStyle = fb; t.fillRect(B.x, B.y, B.w, B.h); t.strokeRect(B.x, B.y, B.w, B.h);
    const ba = bubbleOf("captions", A, lw, "narration",
      (c) => { rectPath(c, A); c.fill(); c.lineWidth = lw + 1; c.globalCompositeOperation = "destination-out"; c.stroke(); rectPath(c, B); c.fill(); c.stroke(); },
      (c) => { rectPath(c, A); c.lineWidth = lw; c.stroke(); c.globalCompositeOperation = "destination-out"; rectPath(c, B); c.fill(); });
    const bb = bubbleOf("captions", B, lw, "narration",
      (c) => { rectPath(c, B); c.fill(); c.lineWidth = lw + 1; c.globalCompositeOperation = "destination-out"; c.stroke(); },
      (c) => { rectPath(c, B); c.lineWidth = lw; c.stroke(); });
    const col = ink();
    block(la, drawLettering(k, la, A.x + m, A.y + m, col, false), ba, "narration", "captions", false);
    block(lb, drawLettering(k, lb, B.x + m, B.y + m, col, false), bb, "narration", "captions", false);
  };

  // One bubble of two lobes set diagonally, one speaker in each; one outline around both
  const lobes = (p) => {
    const size = sizeOf(), la = lettering(r, script, vertical, size, "bubble"), lb = lettering(r, script, vertical, size, "bubble");
    const ea = { rx: la.w * 0.75 + size * 0.6, ry: la.h * 0.75 + size * 0.6 }, eb = { rx: lb.w * 0.75 + size * 0.6, ry: lb.h * 0.75 + size * 0.6 };
    const up = r() < 0.5; // lobe a up and right of lobe b, or up and left
    const ox = (ea.rx + eb.rx) * r.range(0.45, 0.65), oy = (ea.ry + eb.ry) * r.range(0.5, 0.7);
    const W2 = ox + ea.rx + eb.rx, H2 = oy + ea.ry + eb.ry, spot = spotFor(p, W2, H2);
    if (!spot) return;
    occupied.push(spot);
    ea.cy = spot.y + ea.ry; eb.cy = ea.cy + oy;
    if (up) { eb.cx = spot.x + eb.rx; ea.cx = eb.cx + ox; } else { ea.cx = spot.x + ea.rx; eb.cx = ea.cx + ox; }
    const lw = r.range(1.5, 3.5), f = fill();
    // both outlines, then both insides filled again: one continuous outline around the two
    for (const e of [ea, eb]) { ellPath(t, e); t.fillStyle = f; t.fill(); t.lineWidth = lw; t.strokeStyle = "#111"; t.stroke(); }
    for (const e of [ea, eb]) { ellPath(t, { ...e, rx: e.rx - lw / 2, ry: e.ry - lw / 2 }); t.fillStyle = f; t.fill(); }
    const box = { x: Math.min(ea.cx - ea.rx, eb.cx - eb.rx), y: ea.cy - ea.ry, w: 0, h: 0 };
    box.w = Math.max(ea.cx + ea.rx, eb.cx + eb.rx) - box.x; box.h = eb.cy + eb.ry - box.y;
    const b = bubbleOf("lobes", box, lw, "bubble",
      (c) => { for (const e of [ea, eb]) { ellPath(c, { ...e, rx: e.rx - (lw + 1) / 2, ry: e.ry - (lw + 1) / 2 }); c.fill(); } },
      (c) => { for (const e of [ea, eb]) { ellPath(c, e); c.lineWidth = lw; c.stroke(); } c.globalCompositeOperation = "destination-out"; for (const e of [ea, eb]) { ellPath(c, { ...e, rx: e.rx - lw / 2, ry: e.ry - lw / 2 }); c.fill(); } });
    const col = ink();
    block(la, drawLettering(k, la, ea.cx - la.w / 2, ea.cy - la.h / 2, col, false), b, "bubble", "lobes", true);
    block(lb, drawLettering(k, lb, eb.cx - lb.w / 2, eb.cy - lb.h / 2, col, false), b, "bubble", "lobes", true);
  };

  // A bubble with straight sides at a slant, its rows set along the slant (each row inside, the
  // block's box reaching past the sides at two corners)
  const slanted = (p) => {
    const size = sizeOf(), l = lettering(r, script, false, size, "bubble");
    if (l.lines.length < 2) return;
    const lh = l.lh || size * 1.2, k1 = (r() < 0.5 ? -1 : 1) * r.range(0.25, 0.6); // x shift per px down
    const m = size * 0.8, shift = k1 * l.h, W2 = l.w + Math.abs(shift) + 2 * m, H2 = l.h + 2 * m, spot = spotFor(p, W2, H2);
    if (!spot) return;
    occupied.push(spot);
    const x0 = spot.x + m + Math.max(0, -shift), y0 = spot.y + m; // the block's top-left, unshifted
    const at = (y) => k1 * (y - y0); // the slant's shift at a row
    const pts = [[x0 - m * 0.6 + at(y0 - m), y0 - m], [x0 + l.w + m * 0.6 + at(y0 - m), y0 - m], [x0 + l.w + m * 0.6 + at(y0 + l.h + m), y0 + l.h + m], [x0 - m * 0.6 + at(y0 + l.h + m), y0 + l.h + m]];
    const lw = r.range(1.5, 3.5), shape = { pts, lw };
    drawShape(t, shape, fill(), "#111");
    const xs = pts.map((q) => q[0]), box = { x: Math.min(...xs), y: y0 - m, w: Math.max(...xs) - Math.min(...xs), h: l.h + 2 * m };
    const b = bubbleOf("slanted", box, lw, "bubble",
      (c) => { path(c, shape); c.fill(); c.lineWidth = lw + 1; c.globalCompositeOperation = "destination-out"; c.stroke(); },
      (c) => { path(c, shape); c.lineWidth = lw; c.stroke(); });
    // each row centred on the slanted centre line
    k.save(); k.font = l.font; k.fillStyle = ink(); k.textBaseline = "top"; k.textAlign = "center";
    l.lines.forEach((row, i) => { const y = y0 + i * lh; k.fillText(row, x0 + l.w / 2 + at(y + lh / 2), y); });
    k.restore();
    const lx = [x0 + at(y0), x0 + at(y0 + l.h)];
    block(l, { x: Math.min(...lx), y: y0, w: l.w + Math.abs(shift), h: l.h }, b, "bubble", "slanted", false);
  };

  // A narrow bubble: the line broken into short rows (a word or two), as letterers do in a tall shape
  const narrow = (p) => {
    const size = sizeOf();
    let l = null, e = null;
    for (let tries = 0; tries < 6 && !e; tries++) {
      l = lettering(r, script, vertical, size, "bubble");
      if (!l.vertical) { // the same words, one a row
        const rows = l.text.split(" ");
        meas.font = l.font; l.lines = rows; l.w = Math.max(...rows.map((q) => meas.measureText(q).width)); l.h = rows.length * (l.lh || size * 1.2);
      }
      const cand = { rx: l.w / 2 + size * 0.7, ry: l.h / 2 + size * 1.1 };
      if (cand.ry >= 1.5 * cand.rx) e = cand; // narrow: half again as tall as wide, or more
    }
    const spot = e && spotFor(p, 2 * e.rx, 2 * e.ry);
    if (!spot) return;
    occupied.push(spot);
    e.cx = spot.x + e.rx; e.cy = spot.y + e.ry;
    const lw = r.range(1.5, 3.5), f = fill();
    ellPath(t, e); t.fillStyle = f; t.fill(); t.lineWidth = lw; t.strokeStyle = "#111"; t.stroke();
    const b = bubbleOf("narrow", { x: spot.x, y: spot.y, w: 2 * e.rx, h: 2 * e.ry }, lw, "bubble",
      (c) => { ellPath(c, e); c.fill(); c.lineWidth = lw + 1; c.globalCompositeOperation = "destination-out"; c.stroke(); },
      (c) => { ellPath(c, e); c.lineWidth = lw; c.stroke(); });
    block(l, drawLettering(k, l, e.cx - l.w / 2, e.cy - l.h / 2, ink(), false), b, "bubble", "narrow", false);
  };

  const kinds = [captions, lobes, slanted, narrow];
  for (const p of panels) if (r() < 0.55) r.pick(kinds)(p);
}
// ---------- what a webtoon episode showed (opts.webtoon) ----------
function webtoon(r, { t, k, panels, occupied, bubbles, blocks, script, vertical }, cutsAtLettering = false) {
  const sizeOf = () => Math.round(vertical ? r.range(16, 30) : r.range(12, 24) * (script === "ko" ? 1.1 : 1));
  const DEEP = ["#8a0d12", "#5b0f6e", "#0d3f7a", "#7a4a0d"]; // deep red (as seen), purple, blue, brown
  const ellPath = (c, e) => { c.beginPath(); c.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2); };
  // a bubble as an ellipse: its fill (a colour or a gradient), its outline's colour, its lettering's
  const put = (e, l, fill, line, letters, kind) => {
    const lw = r.range(1.5, 3.5);
    ellPath(t, e); t.fillStyle = fill; t.fill(); t.lineWidth = lw; t.strokeStyle = line; t.stroke();
    const box = { x: e.cx - e.rx, y: e.cy - e.ry, w: 2 * e.rx, h: 2 * e.ry };
    const b = { box, lw, shape: kind, kind: "bubble", id: bubbles.length + 1, inside: maskFrom((c) => { ellPath(c, e); c.fill(); c.lineWidth = lw + 1; c.globalCompositeOperation = "destination-out"; c.stroke(); }), outline: maskFrom((c) => { ellPath(c, e); c.lineWidth = lw; c.stroke(); }) };
    bubbles.push(b);
    const at = drawLettering(k, l, e.cx - l.w / 2, e.cy - l.h / 2, letters, false);
    blocks.push({ id: blocks.length, kind: "bubble", script, vertical: l.vertical, letter: l.letter, size: l.size, box: at, text: l.text, bubble: b.id, two: false, shape: kind });
  };
  const dark = (e) => {
    const deep = r.pick(DEEP), g = r() < 0.5 ? t.createLinearGradient(e.cx - e.rx, e.cy - e.ry, e.cx + e.rx * 0.5, e.cy + e.ry) : t.createRadialGradient(e.cx, e.cy + e.ry * 0.3, e.rx * 0.1, e.cx, e.cy, Math.max(e.rx, e.ry));
    g.addColorStop(0, "#0b0506"); g.addColorStop(1, deep);
    return { fill: g, line: r() < 0.6 ? "#e0141c" : deep, letters: r() < 0.6 ? "#ff2a2a" : "#fff" };
  };
  const ellFor = (l, size) => ({ rx: l.w / 2 + size * r.range(1.1, 1.6), ry: l.h / 2 + size * r.range(1.0, 1.4) });
  // A dark bubble in a panel
  const darkOne = (p) => {
    const size = sizeOf(), l = lettering(r, script, vertical, size, "bubble"), e = ellFor(l, size);
    for (let tries = 0; tries < 25; tries++) {
      const cand = { x: p.x + r.range(5, Math.max(6, p.w - 2 * e.rx - 5)), y: p.y + r.range(5, Math.max(6, p.h - 2 * e.ry - 5)), w: 2 * e.rx, h: 2 * e.ry };
      if (cand.x + cand.w < p.x + p.w - 4 && cand.y + cand.h < p.y + p.h - 4 && !occupied.some((o) => overlaps(o, cand, 8))) {
        occupied.push(cand); e.cx = cand.x + e.rx; e.cy = cand.y + e.ry;
        const d = dark(e); put(e, l, d.fill, d.line, d.letters, "dark"); return;
      }
    }
  };
  // A bubble cut by the image's top or bottom edge: a third to a half of it past the edge, its
  // lettering in the part left (white, or dark as above). At the lettering (`atLettering`,
  // opts.cutLettering): the cut falls from a sixth of a letter before the lettering's nearest row
  // to half a letter into it, as the images an episode is served in are cut with no regard to it.
  const cutOne = (atLettering = false) => {
    const size = sizeOf(), l = lettering(r, script, vertical, size, "bubble"), top = r() < 0.5;
    // the part left holds the lettering with room around it; the whole is as much again past the edge
    // (`off`: from the cut to the lettering's nearest row; less than 0 where the cut runs through it)
    let vis, off;
    if (atLettering) { off = size * r.range(-0.5, 1 / 6); vis = l.h + off + size * r.range(0.8, 1.2); }
    else vis = l.h + 2 * size * r.range(0.8, 1.2);
    const f = r.range(0.3, 0.5), ry = vis / (2 * (1 - f));
    const far = atLettering ? Math.max(Math.abs(Math.max(0, off) - ry * (1 - 2 * f)), Math.abs(off + l.h - ry * (1 - 2 * f))) / ry // the farthest row of lettering left from the centre, in radii
      : Math.max(Math.abs(vis / 2 - l.h / 2 - ry * (1 - 2 * f)), Math.abs(vis / 2 + l.h / 2 - ry * (1 - 2 * f))) / ry;
    if (far >= 0.95) return;
    const e = { rx: (l.w / 2 + size * 0.8) / Math.sqrt(1 - far * far), ry };
    if (2 * e.rx > W - 40) return;
    const past = 2 * ry * f;
    e.cx = r.range(e.rx + 10, W - e.rx - 10); e.cy = top ? ry - past : H - ry + past;
    const seen = { x: e.cx - e.rx, y: top ? 0 : H - vis, w: 2 * e.rx, h: vis };
    const ly = !atLettering ? seen.y + vis / 2 - l.h / 2 : top ? off : H - off - l.h;
    if (occupied.some((o) => overlaps(o, seen, 8))) return;
    occupied.push(seen);
    const lw = r.range(1.5, 3.5), d = r() < 0.5 ? dark(e) : { fill: "#fff", line: "#111", letters: "#111" };
    ellPath(t, e); t.fillStyle = d.fill; t.fill(); t.lineWidth = lw; t.strokeStyle = d.line; t.stroke();
    const b = { box: seen, lw, shape: "cut", kind: "bubble", id: bubbles.length + 1, inside: maskFrom((c) => { ellPath(c, e); c.fill(); c.lineWidth = lw + 1; c.globalCompositeOperation = "destination-out"; c.stroke(); }), outline: maskFrom((c) => { ellPath(c, e); c.lineWidth = lw; c.stroke(); }) };
    bubbles.push(b);
    const at = drawLettering(k, l, e.cx - l.w / 2, ly, d.letters, false);
    blocks.push({ id: blocks.length, kind: "bubble", script, vertical: l.vertical, letter: l.letter, size: l.size, box: at, text: l.text, bubble: b.id, two: false, shape: atLettering ? "cutLettering" : "cut", dark: d.fill !== "#fff" });
  };
  if (cutsAtLettering) { for (let i = 0; i < 2; i++) if (r() < 0.8) cutOne(true); return; }
  for (const p of panels) if (r() < 0.4) darkOne(p);
  for (let i = 0; i < 2; i++) if (r() < 0.6) cutOne(); // (the top edge and the bottom, each may be taken)
}

/** A mask (1 inside) drawn by `draw` in white on a page-sized canvas. */
function maskFrom(draw) {
  const m = createCanvas(W, H), c = m.getContext("2d");
  c.fillStyle = "#fff"; c.strokeStyle = "#fff"; draw(c);
  const d = c.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}

// ---------- art ----------
function art(t, p, r, colour) {
  t.save(); t.beginPath(); t.rect(p.x, p.y, p.w, p.h); t.clip();
  const bg = r();
  if (bg < 0.3) { const s = r.int(4, 8), rad = s * r.range(0.18, 0.35); t.fillStyle = colour ? r.pick(["#7a8fb8", "#999", "#b88a7a"]) : "#222"; for (let yy = p.y; yy < p.y + p.h; yy += s) for (let xx = p.x + ((yy / s) % 2 ? s / 2 : 0); xx < p.x + p.w; xx += s) { t.beginPath(); t.arc(xx, yy, rad, 0, 7); t.fill(); } }
  else if (bg < 0.45) { const g = t.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h); g.addColorStop(0, colour ? "#cfe0f5" : "#ddd"); g.addColorStop(1, colour ? "#f5d9cf" : "#888"); t.fillStyle = g; t.fillRect(p.x, p.y, p.w, p.h); }
  else if (bg < 0.6) { t.strokeStyle = "#333"; t.lineWidth = 1; const s = r.int(5, 10); for (let k = -p.h; k < p.w; k += s) { t.beginPath(); t.moveTo(p.x + k, p.y); t.lineTo(p.x + k + p.h, p.y + p.h); t.stroke(); } }
  else if (colour) { t.fillStyle = r.pick(["#f3ead8", "#e3eef7", "#efe4ef"]); t.fillRect(p.x, p.y, p.w, p.h); }
  // shapes: dark masses (hair, clothes), strokes, speed lines
  for (let i = 0, n = r.int(2, 7); i < n; i++) {
    const cx = p.x + r() * p.w, cy = p.y + r() * p.h, s = r.range(20, Math.min(p.w, p.h) * 0.45);
    t.beginPath(); t.moveTo(cx + s, cy);
    for (let a = 0; a <= 12; a++) { const ang = (a / 12) * Math.PI * 2, rr = s * r.range(0.5, 1.1); t.quadraticCurveTo(cx + Math.cos(ang - 0.26) * rr * 1.2, cy + Math.sin(ang - 0.26) * rr * 1.2, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr); }
    t.fillStyle = colour ? r.pick(["#3b2a20", "#20304b", "#5a1d2a", "#c98d5a"]) : r.pick(["#111", "#111", "#555", "#fff"]); t.fill();
    t.lineWidth = r.range(1, 4); t.strokeStyle = "#111"; t.stroke();
  }
  for (let i = 0, n = r.int(3, 15); i < n; i++) { t.beginPath(); t.moveTo(p.x + r() * p.w, p.y + r() * p.h); t.bezierCurveTo(p.x + r() * p.w, p.y + r() * p.h, p.x + r() * p.w, p.y + r() * p.h, p.x + r() * p.w, p.y + r() * p.h); t.lineWidth = r.range(1, 5); t.strokeStyle = "#111"; t.stroke(); }
  t.restore();
  t.lineWidth = 3; t.strokeStyle = "#111"; t.strokeRect(p.x, p.y, p.w, p.h);
}

// ---------- bubbles ----------
function shapeOf(r, shape, b, lw) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2, pts = [];
  const n = 72, bumps = r.int(9, 15), spikes = r.int(12, 20);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let k = 1;
    if (shape === "cloud") k = 0.93 + 0.07 * Math.abs(Math.sin(a * bumps / 2));
    if (shape === "burst") k = i % Math.round(n / spikes) === 0 ? 1 : 0.78;
    if (shape === "round") { const e = 6; const c = Math.cos(a), s = Math.sin(a); const sx = Math.sign(c) * Math.abs(c) ** (2 / e), sy = Math.sign(s) * Math.abs(s) ** (2 / e); pts.push([cx + rx * sx, cy + ry * sy]); continue; }
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  if (shape === "box") return { box: b, lw, rect: true, pts: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]] };
  return { box: b, lw, pts };
}
function path(c, s) { c.beginPath(); s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
function drawShape(c, s, fill, stroke) { path(c, s); c.fillStyle = fill; c.fill(); c.lineWidth = s.lw; c.strokeStyle = stroke; c.lineJoin = "round"; c.stroke(); }
function maskOf(s, which) {
  const m = createCanvas(W, H), c = m.getContext("2d");
  if (which === "inside") { path(c, s); c.fillStyle = "#fff"; c.fill(); c.lineWidth = s.lw + 1; c.globalCompositeOperation = "destination-out"; c.strokeStyle = "#000"; c.stroke(); }
  else { path(c, s); c.lineWidth = s.lw; c.strokeStyle = "#fff"; c.stroke(); }
  const d = c.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}
const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

// ---------- lettering ----------
const meas = createCanvas(10, 10).getContext("2d");
function lettering(r, script, vertical, size, kind, marks = false) {
  const cjk = script === "ja" || script === "zh" || script === "ko";
  const family = cjk ? r.pick(CJK_FONTS[script]) : r.pick(LATIN_FONTS);
  const font = `bold ${size}px "${family}"`;
  meas.font = font;
  if (marks) { const text = r.pick(["……", "!?", "…!"]); return { lines: [text], vertical: false, font, size, w: meas.measureText(text).width, h: size * 1.2, text, letter: size * 0.7 }; }
  if (vertical && script !== "ko") {
    const pool = POOL[script], cols = r.int(1, 4), lines = [];
    for (let i = 0; i < cols; i++) { let s = ""; const n = r.int(2, 8); for (let j = 0; j < n; j++) s += r.pick([...pool]); if (r() < 0.3) s += r.pick(["！", "？", "…", "ー"]); lines.push(s); }
    const g = meas.measureText("国"), glyph = g.actualBoundingBoxLeft + g.actualBoundingBoxRight;
    const colW = size * 1.0, gap = size * r.range(0.25, 0.5);
    return { lines, vertical: true, font, size, w: cols * colW + (cols - 1) * gap, h: Math.max(...lines.map((l) => [...l].length)) * size * 1.05, colW, gap, text: lines.join(""), letter: glyph };
  }
  const lines = [];
  if (cjk) { const rowsN = r.int(1, 4); for (let i = 0; i < rowsN; i++) { let s = ""; const n = r.int(3, 9); for (let j = 0; j < n; j++) s += (j && r() < 0.25 ? " " : "") + r.pick([...POOL[script]]); lines.push(s + (r() < 0.3 ? r.pick(["!", "?", "..."]) : "")); } }
  else { const rowsN = r.int(1, 6); for (let i = 0; i < rowsN; i++) { const n = r() < 0.5 ? 1 : r.int(2, 3); lines.push(Array.from({ length: n }, () => r.pick(WORDS[script])).join(" ")); } }
  const upper = !cjk && r() < 0.25 ? false : true;
  const text = upper ? lines : lines.map((l) => l.charAt(0) + l.slice(1).toLowerCase());
  const lh = size * r.range(1.08, 1.35);
  const cap = cjk ? (() => { const m = meas.measureText(script === "ko" ? "한" : "国"); return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent; })() : meas.measureText("H").actualBoundingBoxAscent;
  return { lines: text, vertical: false, font, size, w: Math.max(...text.map((l) => meas.measureText(l).width)), h: text.length * lh, lh, text: text.join(" "), letter: cap, italic: !cjk && r() < 0.25 };
}
function drawLettering(c, l, x, y, color, halo) {
  c.save(); c.font = l.font; c.fillStyle = color; c.textBaseline = "top";
  const draw = (s, px, py) => { if (halo) { c.lineWidth = l.size * 0.28; c.lineJoin = "round"; c.strokeStyle = "#fff"; c.strokeText(s, px, py); } c.fillText(s, px, py); };
  if (l.vertical) {
    l.lines.forEach((col, i) => {
      const cx = x + l.w - (i + 1) * l.colW - i * l.gap;
      [...col].forEach((ch, j) => {
        const vch = { "ー": "｜", "…": "︙", "、": "︑", "。": "︒" }[ch] || ch;
        c.textAlign = "center"; draw(vch, cx + l.colW / 2, y + j * l.size * 1.05);
      });
    });
  } else {
    c.textAlign = "center";
    if (l.italic) c.transform(1, 0, -0.2, 1, 0.2 * (y + l.h / 2), 0);
    l.lines.forEach((s, i) => draw(s, x + l.w / 2, y + i * (l.lh || l.size * 1.2)));
  }
  c.restore();
  return { x, y, w: l.w, h: l.h };
}

/** A stand-in for Claude's English: about as long as the line would be translated. */
export function englishFor(block, r) {
  const n = [...block.text.replace(/\s/g, "")].length;
  const want = Math.max(4, Math.round(n * (block.script === "ja" || block.script === "zh" ? 2.3 : block.script === "ko" ? 2.0 : 1.05)));
  let s = "";
  while (s.length < want) s += (s ? " " : "") + r.pick(EN_OUT);
  return s.charAt(0).toUpperCase() + s.slice(1) + r.pick([".", "!", "?", "..."]);
}
export { rng };
