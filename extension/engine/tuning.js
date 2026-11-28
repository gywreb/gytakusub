// The numbers the engine decides with, by stage, in one place (3.0).
//
// Units: `letter` is a letter size in pixels (a region's, or the page's dialogue size); "share"
// is a share of an area or a length; grey levels are 0–255.
//
// Where they come from: unless a line says otherwise, a value was set by hand, looking at pages
// while fixing a report, before the bench existed (docs/adr/0017). None was fitted to the bench.
// Changing one is an engine change like any other: it ships only when the held-out pages are no
// worse (docs/QUALITY.md). The bench can vary each one (GYT_TUNE, below) to find the values a result hangs on.
//
// Not here: what belongs to a model (its input sizes and normalisation, the bubble model's
// thresholds in vendor/segment.json); small integers that are an algorithm's shape (a 3×3
// neighbourhood, 8-connectivity, halving); and analyze-heuristic.js, the rule-based analysis used
// only when no text detector loads, which keeps its own.

/**
 * A stage's values, frozen. `globalThis.GYT_TUNE` (set by the bench before the engine loads:
 * tests/bench/tune-env.mjs) may change some for one run, e.g. { LAYOUT: { adoptMaxLetter: 5 } };
 * a name that is not a value here is an error. Nothing sets it in the extension or the web app.
 */
function tune(stage, values) {
  for (const [k, v] of Object.entries(globalThis.GYT_TUNE?.[stage] || {})) {
    if (!(k in values)) throw new Error(`GYT_TUNE: ${stage}.${k} is not a tuning value`);
    values[k] = v;
  }
  return Object.freeze(values);
}

// Shared by several stages, so each has one value.
const LINE_LETTER = 0.85; // a detector line's letter size: this share of its height (its width, vertical)
const GLYPH_WIDTH = 0.6;  // a horizontal glyph is this share of the letter size wide
const MIN_LETTER_PX = 4;  // no letter size below this
const LINE_SCORE = 0.7;   // a detector line scored this or more is taken as lettering without other evidence

/** Where each translation goes (layout.js). */
export const LAYOUT = tune("LAYOUT", {
  // A box lies on a region when at least this share of it does (used throughout).
  most: 0.5,

  // Lettering Claude read as Hangul is set at its syllables' height (analyze.js syllableHeight)
  hangulShare: 0.5,       // at least this share of its letters in Hangul
  hangulWeightMax: 40,    // a block's weight in that height, in glyphs, at most (as for the page's letter)

  // Tag against box (a misread stamp)
  strayOnStamp: 0.25,     // a box this little on its stamped region, and mostly on another: the other one
  driftNear: 0.5,         // box drifted off its stamped region by this much of its size: checked against the text's length
  driftFar: 1,            // ...and by this much, the stamp is dropped whatever the length
  lengthLow: 0.4,         // translation length / letters found outside this range: not that region's text
  lengthHigh: 4,
  narrowLetters: 3,       // a bubble under this many letters wide...
  narrowChars: 4,         // ...takes no line longer than this (one letter per row)
  canHold: 0.25,          // a region smaller than this share of the box can't hold its text
  shapeBonus: 0.5,        // a region whose shape holds the box's centre counts this much more
  holderScore: 0.5,       // the best region scores at least this, or the box has none

  // Inside a bubble
  anchorLetter: 0.5,      // lettering this share of the bubble's letter size, or more, can anchor a line...
  anchorArea: 0.1,        // ...and this share of its largest block (smaller: specks, tone dots)
  keepClear: 0.3,         // letters of room kept around regions inside the bubble and lettering left as drawn
  speakerClear: 0.5,      // letters of room kept around another speaker's lettering
  slackLetters: 1.5,      // an anchored rectangle may move this many letters...
  slackShare: 0.15,       // ...or this share of the bubble's smaller side, whichever is more
  fallbackInset: 0.78,    // no rectangle found: this share of the bubble's box
  airInset: 0.92,         // the rectangle found, shrunk to this share: letters don't touch the outline
  edgeLetters: 0.15,      // rows set to the bubble's shape keep this many letters off its outline's ink (the one margin: 2.15)...
  edgeMinPx: 3,           // ...and at least these pixels
  letteringHeld: 0.85,    // a bubble whose interior holds less of the lettering than this is doubted: the lettering's boxes are room
  partsCover: 0.6,        // a region's ink divides it into parts (one per line) only when they cover this share of it together
  altOffset: 1,           // the lettering's centre this many letters off its room's: the text is also tried centred on the lettering
  axisOffset: 0.25,       // the room's own centre line this many letters off the text's: the text is also tried centred on the room's (3.0)
  joinShare: 0.3,         // a line without lettering of its own joins the anchor holding this share of its box
  cutMargin: 0.1,         // lines side by side: no cut closer than this share of the bubble to its edge
  moveMin: 0.1,           // a line moves to a region holding at least this share of its box
  shapeRows: 100,         // a bubble's shape is read in this many rows (its smaller side)
  rectRows: 60,           // the largest rectangle is searched on this many rows
  waistMinPx: 6,          // a stretch shorter than this has no waist
  waistRows: 40,          // waist search: rows along...
  waistCross: 80,         // ...and samples across
  waistNarrow: 0.8,       // a waist is narrower than this share of the ends
  minRectPx: 4,           // no rectangle smaller than this
  minSplitPx: 8,          // two overlapping rectangles split, each kept at least this size

  // Free text
  freePad: 0.5,           // letters of room around free text's footprint
  columnTall: 1.7,        // free text taller than this × its width is a column...
  columnWidth: 0.6,       // ...widened toward this share of its height
  widenTries: Object.freeze([1, 0.75, 0.5, 0.25]), // shares of that widening tried, most first
  widenClash: 0.05,       // the widening stops before it covers this share of another region

  // Adopting lettering the analysis set aside (adoptLettering)
  adoptMaxLetter: 4,      // never lettering over this × the dialogue size (a shout is three or four; a drawn sound effect beyond)
  adoptScore: 0.6,        // a set-aside paragraph scored under this is not taken...
  adoptPieces: 3,         // ...nor one sliced from a tall box into this many lines or more
  lineScore: LINE_SCORE,  // a detector line under this score is not taken...
  secondLookScore: 0.5,   // ...or under this, when the second look found it on Claude's box
  lineLetter: LINE_LETTER,
  minLetterPx: MIN_LETTER_PX,
  glyphWidth: GLYPH_WIDTH,
  adoptZone: 0.1,         // Claude's box widened by this share each side...
  adoptZoneLetters: 0.5,  // ...and by this many letters
  adoptInside: 0.7,       // lettering this share inside that zone is the line's...
  adoptCore: 0.8,         // ...or the box this share on the lettering...
  adoptCoreMax: 4,        // ...when the lettering is at most this × the box
  adoptSliver: 0.25,      // a piece overlapping the box less than this (against both sizes) is not taken
});

/** The eraser: what the mask takes, and the fill (erase.js). */
export const ERASE = tune("ERASE", {
  // A surround is plain when PLAIN_SHARE of its pixels lie within colourPlain of their median in
  // every channel; there, lettering is what lies more than colourApart from it in some channel.
  colourPlain: 40,
  colourApart: 64,
  plainShare: 0.9,
  adoptedTaken: 0.6,      // adopted lettering is erased only when this share of its line's ink is taken
  ringSamples: 24,        // a window's surround needs this many pixels to judge colour lettering
  surfaceSamples: 50,     // a bubble's surface needs this many to judge plain or flat
  depthPx: 3,             // surface samples lie this deep inside the bubble
  flatLevel: 8,           // flat: within this many grey levels of the median (JPEG noise)...
  flatShare: 0.95,        // ...for this share of the surface

  // The mask, around a line's box
  padAcross: 0.35,        // letters of the box's pad across the line...
  padAcrossMinPx: 2,
  padAlong: 0.7,          // ...and along it
  padAlongMinPx: 3,
  markLetters: 2.5,       // a mark at most this many letters across the line is lettering...
  penShare: 0.35,         // ...drawn with its pen: no thinner than this share of the line's (erase.js penOf)...
  penMinPx: 2,            // ...when that share is this many pixels or more (a thinner pen judges nothing)
  longLetters: 3,         // a mark longer than this many letters is a stroke...
  strokeLetters: 1.2,     // ...kept only if at most this many letters thick...
  strokeSpan: 0.9,        // ...and shorter than this share of the bubble
  keepDepthLetters: 0.3,  // a kept mark's corners lie this deep inside the bubble...
  keepDepthMinPx: 3,
  glyphArea: 0.2,         // a glyph over this share of the bubble's area is not lettering...
  glyphLetters: 1.6,      // ...nor one taller than this many letters
  minBoxPx: 4,            // no sweep of a box smaller than this
  minLetterPx: MIN_LETTER_PX,
  lineLetter: LINE_LETTER,
  fringeLetters: 0.15,    // the mask grows over a stroke's anti-aliased fringe by this many letters...
  fringeMinPx: 2,
  outlineLight: 200,      // ...never over a dark bubble's outline (grey above this)...
  outlineDark: 70,        // ...or a light bubble's (below this)
  defaultLetter: 8,       // an area with no letter size
  modelBubbleShare: 0.5,  // the learned text mask over more of a bubble's interior than this took the bubble for lettering
  modelThickLines: 1.5,   // ...as did a piece of it thicker than this many times the height of the lines it lies on
  readerBoxShare: 0.5,    // a piece of the mask with less of it inside a translated line's box is not that line's lettering (a region made from the box alone; the rest of a free-text paragraph, 3.6)

  // The fill
  fillPad: 0.8,           // the area filled reaches this many letters past the lettering
  bubbleRadius: 3,        // Telea's neighbourhood in a bubble (px)
  teleaLetters: 0.3,      // elsewhere this many letters...
  teleaMin: 3,
  teleaMax: 6,            // ...at most: its time grows with the square (a 125 px sound effect took 35.6 s at 0.3 letter; 2.14)
  fullSizeCut: 63,        // at full size, a quarter of a work pixel's coverage counts
  contextLetters: 2,      // the texture fill sees this many letters around an area...
  contextMinPx: 24,
});

/** Page analysis: lines snapped to the ink, paragraphs, bubbles (analyze.js). */
export const ANALYZE = tune("ANALYZE", {
  // Ink and surfaces (grey levels)
  inkDark: 105,           // dark lettering: below this
  inkLight: 165,          // light lettering: above this
  lightSurfaceBlur: 190,  // a light bubble's surface: above this blurred...
  lightSurfaceRaw: 150,   // ...and this unblurred
  darkSurfaceBlur: 60,    // a dark bubble's surface: below this blurred...
  darkSurfaceRaw: 90,     // ...and this unblurred
  darkSurface: 110,       // a model's bubble is dark when its mean grey is below this
  blurDiv: 320,           // the surface blur: page width / this, odd...
  blurMin: 3,
  blurMax: 7,

  // A line's polarity and snapping
  contrastShare: 0.1,     // a box with less than this share of dark or light pixels holds no lettering
  darkShare: 0.55,        // light lettering: the box this share dark...
  lightMarks: 0.05,       // ...with this share of light marks
  coreInset: 0.2,         // each line's core (inset this share each side) is off limits to its neighbours' snapping
  growShare: 0.35,        // a line's box may grow by this share across...
  tailOwned: 1.5,         // ...and along, by this many line heights in a bubble...
  tailFree: 0.6,          // ...or this many outside one (punctuation the detector leaves out)
  trimKeep: 0.4,          // empty edges are trimmed down to this share of the box at most
  minSnapPx: 4,
  minSnappedPx: 3,        // a box snapped below this holds no lettering
  splitTall: 1.7,         // a box this × the page's typical line height...
  splitLong: 2,           // ...and this many heights long is several lines

  // Letter size
  letterScale: 1.15,      // cap height to letter size
  rowPeak: 0.3,           // a row's letters span the rows with this share of the peak's ink
  columnPeak: 0.12,       // a column's: this share
  syllablePeak: 0.1,      // a row of Hangul syllables spans the rows with this share of the peak's ink...
  syllableMarkH: 1.6,     // ...counting marks up to this × the row's letter tall...
  syllableMarkW: 2,       // ...and this × wide (a caption box's sides run down every row)
  glyphSwitch: 0.4,       // the band below this share of the glyphs' height: the glyphs set the size
  minBandPx: 4,
  minMarkPx: 4,           // marks of fewer pixels are not glyphs
  rowMinPx: 3,            // in a column, a row of letters is at least this tall...
  rowWidth: 0.5,          // ...this share of the column wide...
  rowMarks: 3,            // ...with this many marks across
  columnRows: 3.5,        // a column this many rows wide: the rows set the size
  weightMax: 40,          // a paragraph's weight in the page's size, in glyphs, at most
  minPageLetter: 8,       // a page with no paragraphs: this, or the width / pageLetterDiv
  pageLetterDiv: 60,
  glyphWidth: GLYPH_WIDTH,
  columnPitch: 0.5,       // a column's glyphs are at least this share of the typical column apart
  readingBands: 24,       // reading order: the page in this many bands

  // What is lettering
  letterMark: 0.35,       // a mark this share of the letter or more is letter-sized
  markMax: 2,             // a mark over this many letters is an outline or art
  longestMax: 0.8,        // no mark may span more than this share of the line
  letterInk: 0.6,         // ...or this share of the ink is in letter-sized marks
  marginPx: 3,            // marks running past the box by this margin are not its glyphs
  solidCore: 0.6,         // a mark solid to its middle (stroke this share of its width)...
  solidSize: 0.6,         // ...and this share of a letter across...
  solidBar: 2,            // ...and no more than this × its width long (a bar is a stem)...
  solidShare: 0.5,        // ...makes this share of the glyphs' ink: eyes, a shadow
  freeScore: 0.6,         // loose text: detector score at least this...
  freeMin: 0.6,           // ...and its band this share of the page's...
  freeMax: 2.5,           // ...to this many times it
  voteSteps: 16,          // a paragraph's surface is sampled on this many steps
  voteShare: 0.3,         // the surface holding this share of the samples holds the paragraph

  // Ruby (furigana)
  rubyTall: 0.8,          // ruby's box is at least this tall for its width
  rubyThin: 0.65,         // and at most this share of the column's size wide
  rubyBandMax: 0.7,       // a snapped ruby line's band is this share of its column's at most...
  rubyBandMin: 0.3,       // ...and at least this
  rubyGap: 0.8,           // at most this many column widths beside it
  rubyCentreLo: 0.25,     // its centre outside the column's middle half
  rubyCentreHi: 0.75,
  rubyReach: 0.5,         // within this many column widths of the column's ends

  // Bubbles from the light regions (the rules)
  minFrac: 0.0006,        // a bubble covers this share of the page at least...
  maxFracSegmented: 0.08, // ...and at most this with a bubble model (a larger light region was always a panel's background)...
  maxFracRules: 0.2,      // ...or this without one
  maxWidth: 0.8,          // no wider than this share of the page...
  maxHeight: 0.6,         // ...taller than this...
  maxArea: 0.3,           // ...or larger than this
  shapeFill: 0.85,        // a line this share of the shape each way, with a mark or two: the shape read as a glyph
  minFill: 0.3,           // the region fills this share of its box at least
  maxHoles: 0.35,         // holes (what is drawn inside) at most this share
  minSolidity: 0.45,      // area / convex hull at least this
  holePad: 0.4,           // the holes must lie within the lettering's boxes grown by this many letters...
  holePadMinPx: 2,
  holesInText: 0.45,      // ...this share of them at least
  markToShape: 0.55,      // the lettering at most this share of the shape's smaller side
  bubbleMaxBand: 2.5,     // and at most this × the page's dialogue size
  nestShare: 0.5,         // a shape holding a bubble under this share of its area is a background

  // Bubbles from the bubble model
  segMinFrac: 0.0004,     // an instance covers this share of the page at least...
  segMaxFrac: 0.3,        // ...at most this...
  segMinFill: 0.3,        // ...and fills this share of its box
  fitShare: 0.25,         // a bubble of only marks ("……") is set at the page's size, no more than this share of it across...
  fitMinPx: 8,
  marksOnly: 0.4,         // ...when its lettering measures under this share of the page's

  // Widening a bubble's interior past its lettering's region
  widenWindow: 0.3,       // the search reaches this share of the bubble around it...
  widenWindowPx: 4,
  minWindowPx: 8,
  structuralLetters: 2.5, // ink longer than this many letters is the outline
  minLetterPx: MIN_LETTER_PX,
  sealWidePage: 1200,     // the outline is thickened 5 px on pages wider than this, 3 px below
  sealWide: 5,
  sealNarrow: 3,
  tailCutMin: 7,          // the opening that cuts off a tail: page width / tailCutDiv, from this...
  tailCutMax: 25,         // ...to this, odd (a tail tip is ~10 px at 850 px; a bubble body is never that thin)
  tailCutDiv: 65,
  widenMin: 1.05,         // widened only when this much larger...
  widenMax: 3,            // ...and at most this many times
  widenSolidity: 0.5,
});

/** The text detector's post-processing and its second looks (detect.js). The input normalisation
 * and the size multiple of 32 are the model's own and stay there. */
export const DETECT = tune("DETECT", {
  // These four are also written into vendor/ppocr-det.json, which the engine reads, by
  // scripts/vendor-detector.mjs from here; CI regenerates that record and fails if it differs.
  maxSide: 960,           // the page's longest side at the model's input
  thresh: 0.3,            // DB: probability threshold...
  boxThresh: 0.5,         // ...a box's minimum mean score...
  unclip: 1.6,            // ...and how far its shrunk region grows back
  minComponentPx: 12,     // components smaller than this, or thinner than minSidePx, are noise
  minSidePx: 3,
  verticalAspect: 1.5,    // a box this much taller than wide is a column
  lineScore: LINE_SCORE,  // lines the layout takes as they are

  // A second look inside bubbles with no line, and inside dark shapes
  bubbleMinPx: 12,
  cropZoom: 2,            // such a crop is read at up to this zoom
  darkShape: 70,          // dark shapes: grey below this...
  shapeMinArea: 0.002,    // ...covering this share of the page...
  shapeMaxArea: 0.06,     // ...to this...
  shapeMinFill: 0.45,     // ...filling this share of their box...
  shapeMaxAspect: 4,      // ...no longer than this × their width...
  shapeSolidity: 0.9,     // ...convex...
  shapeFilled: 0.6,       // ...solid once their holes are filled...
  shapeLightInk: 180,     // ...holding light ink (above this grey)...
  shapeLightMin: 0.01,    // ...over this share of them...
  shapeLightMax: 0.35,    // ...and no more than this (a highlight)

  // A second look on Claude's box (detectInTranslatedBoxes)
  lookMinPx: 6,           // no look at a box smaller than this
  lookCovered: 0.25,      // nor at one whose lines already cover this share
  lookMargin: 0.5,        // the crop reaches this share of the box around it...
  lookMarginPx: 24,       // ...counted on a box at least this large
  lookMinCropPx: 8,
  lookSide: 640,          // read at this size...
  lookZoom: 4,            // ...zoomed this much at most
  lookKeep: 0.25,         // a line found is kept when its centre lies in the box grown by this share each side
});

/** The screentone fill: the lattice, its check, the copy (tone.js). */
export const TONE = tune("TONE", {
  validate: 0.5,          // the lattice's prediction error at most this share of the local average's
  minPeak: 0.25,          // autocorrelation below this is no lattice (noise, art)
  maxPeriod: 20,          // longest lattice vector looked for (px)...
  periodsInArea: 3,       // ...and no longer than the area's smaller side / this
  minPeriod: 3,
  minKnown: 400,          // known pixels needed around the hole
  highPassDiv: 2.5,       // the tone is measured above a blur of period / this...
  highPassMin: 3,
  nearHoleDepths: 2,      // ...on the surface within this many hole depths of it...
  nearHoleMinPx: 12,
  autocorrSample: 20000,  // ...at most this many pixels
  minPairs: 100,          // an autocorrelation from fewer pairs is 0
  minShift2: 4,           // shifts shorter than 2 px (squared) are not periods
  firstPeak: 0.7,         // the shortest peak this share of the highest is the first vector...
  acrossSin: 0.42,        // ...the second at least this far across it (sine of the angle)...
  samePeakPx: 1.5,        // ...not within this of another second's opposite...
  maxSeconds: 3,          // ...this many second vectors tried
  peakFloor: 0.5,         // refining: peaks this share of the two vectors' or more...
  refineRange: 4,         // ...at a·v1 + b·v2 for |a|, |b| up to this...
  refineEdge: 1.5,        // ...not this near the search's edge...
  minPeaksUsed: 3,        // ...at least this many
  minBand: 50,            // the check band needs this many pixels...
  bandSample: 3000,       // ...scored on this many
  reachPeriods: 3,        // a copy reaches this many periods past the band
  seenShare: 0.9,         // this share of the band must be predicted...
  minTexture: 3,          // ...and the surface textured by this many grey levels on average
  maxCopiesOut: 24,       // copies are looked for this many periods out at most...
  copies: 4,              // ...and this many averaged
  leftRadius: 3,          // what no copy reached: Telea at this radius
});

/** The bubble model's output (segment.js). Its confidence, overlap and mask thresholds and its
 * input size belong to the model and are recorded beside it (vendor/segment.json). */
export const SEGMENT = tune("SEGMENT", {
  dupCover: 0.7,          // an instance this share under bubbles already kept is a duplicate
});

/** The learned fill (inpaint.js). The sizes the models take (multiples of 8, at least 72 px; LaMa's
 * 512) are the models' own and stay there. */
export const FILL = tune("FILL", {
  gpuSide: 768,           // the largest side the model inpaints at on a graphics card...
  cpuSide: 384,           // ...and on the CPU: a time budget (ADR 0013)
  greySpread: 24,         // a pixel whose channels spread more than this is coloured...
  greyShare: 0.02,        // ...and an area with this share of such pixels is in colour
});

/** One page (page.js): what the model is shown, and the outline. */
export const PAGE = tune("PAGE", {
  outline: 0.3,           // the mask grows over a lettering's outline by this share of its letter size (ADR 0013)
  jpegQuality: 0.85,      // the page is sent to the model as a JPEG of this quality
  stampMinPx: 9,          // the numbered stamps' radius: the slice's width / stampDiv, at least this
  stampDiv: 70,
  stampFont: 1.25,        // the number's size, × the radius
});
