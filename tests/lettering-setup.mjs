// Loads the page-side lettering into Node the way the extension's page script has it: the
// hyphenation library, the font table, text.js, and every bundled font registered with
// node-canvas under the family the pages use. Run from tests/.
import fs from "node:fs";
import path from "node:path";
import { registerFont } from "canvas";

export function loadLettering() {
  for (const f of ["../extension/vendor/hyphen-en.js", "../extension/vendor/lettering-fonts.js", "../extension/text.js"]) new Function(fs.readFileSync(f, "utf8"))();
  for (const f of globalThis.GyFonts) registerFont(path.join("../extension", f.file), { family: f.family, weight: "bold" });
  return globalThis.GyText;
}
