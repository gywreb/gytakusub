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

/** One page: { W, H, script, input, truth, bubbles: [{id, box, inside, outline}], blocks: [...] } */
export function makePage(seed) {
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
  ix.drawImage(truth, 0, 0); ix.drawImage(ink, 0, 0);
  const inkData = k.getImageData(0, 0, W, H).data;
  for (const b of blocks) { // each block's pixels: its glyphs (core) and its whole footprint (halo too)
    const core = [], foot = [];
    const x0 = Math.max(0, Math.floor(b.box.x - 8)), y0 = Math.max(0, Math.floor(b.box.y - 8)), x1 = Math.min(W, Math.ceil(b.box.x + b.box.w + 8)), y1 = Math.min(H, Math.ceil(b.box.y + b.box.h + 8));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = yy * W + xx, a = inkData[q * 4 + 3]; if (a > 30) foot.push(q); if (a > 140 && inkData[q * 4] + inkData[q * 4 + 1] + inkData[q * 4 + 2] < 450) core.push(q); }
    b.core = Int32Array.from(core); b.foot = Int32Array.from(foot);
  }
  return { W, H, seed, script, colour, input: ix.getImageData(0, 0, W, H), truth: t.getImageData(0, 0, W, H), bubbles, blocks, kept, sfx };
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
