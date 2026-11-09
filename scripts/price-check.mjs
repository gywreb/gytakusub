// Compares the price list in extension/usage.js with the rows of Anthropic's pricing page
// (its Markdown version). Pure; scripts/check-guide.mjs fetches the page every week.
import { PRICES, PRICE_SOURCE } from "../extension/usage.js";

export const PRICE_PAGE = PRICE_SOURCE + ".md";

// "$0.125 / MTok", "$0.20 / MTok<sup>2</sup>" → 0.125, 0.2
const dollars = (cell) => Number((/\$\s*([\d.]+)/.exec(cell.replace(/<[^>]+>/g, "")) || [])[1]);

/** One line per price-list row that the page no longer shows with the same five prices. */
export function priceRowsProblems(markdown) {
  const rows = new Map();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 6) rows.set(cells[0].replace(/\s+/g, " "), cells.slice(1, 6).map(dollars));
  }
  const problems = [];
  for (const p of Object.values(PRICES)) for (const t of p.tiers) {
    const want = [t.input, t.write5m, t.write1h, t.read, t.output];
    const seen = rows.get(t.row);
    if (!seen) problems.push(`"${t.row}" is no longer a row of the pricing table.`);
    else if (seen.some((x, i) => x !== want[i])) problems.push(`"${t.row}": the page says ${seen.map((x) => "$" + x).join(" / ")}, extension/usage.js has ${want.map((x) => "$" + x).join(" / ")} (input / 5m write / 1h write / cache hit / output).`);
  }
  return problems;
}
