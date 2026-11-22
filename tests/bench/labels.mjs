// Claude's size label ("small", "normal", "large") for the simulated answers, as Claude gives it.
// Measured on the owner's debug reports (30 reports, 3,608 lines on a measured region, Nov 2026):
// for each line, its region's letter size against the page's, and the label Claude gave. The label
// follows the size only loosely: lines labelled "small" measure 0.92 of the page's size at the
// median, "large" 1.19. The bench draws each line's label from the share Claude gave at that size.
// (Before 3.0 the simulated Claude labelled every real line "normal", and generated lines by a
// rule that labelled 4% "small" and none "large"; Claude labels 6% "small" and 16% "large".)

/** [upper bound of size / page size, share "small", share "large"] (the rest "normal") */
const BY_SIZE = [
  [0.7, 0.179, 0.069],
  [0.85, 0.11, 0.07],
  [1.0, 0.051, 0.069],
  [1.15, 0.035, 0.096],
  [1.35, 0.011, 0.216],
  [1.7, 0.015, 0.39],
  [Infinity, 0.047, 0.287],
];

/**
 * @param {number} ratio the line's letter size / the page's dialogue size
 * @param {() => number} rnd a uniform draw in [0, 1), of its own stream (the label must not shift
 *   the draws that place Claude's boxes)
 */
export function sizeLabel(ratio, rnd) {
  const [, small, large] = BY_SIZE.find(([hi]) => ratio < hi);
  const u = rnd();
  return u < small ? "small" : u < small + large ? "large" : "normal";
}
