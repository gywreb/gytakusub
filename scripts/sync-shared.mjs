// Copies the files the web app shares with the extension (extension/ is
// canonical) into web/, and the chapter fetcher's code (fetcher/worker.js), which
// the app's setup guide offers for copying and whose version it checks.
// Cross-platform: node scripts/sync-shared.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = (p) => path.join(root, "extension", p), web = (p) => path.join(root, "web", p);

for (const f of ["prompt.js", "text.js", "usage.js", "i18n.js", "languages.js", "LICENSE", "THIRD_PARTY.md"]) fs.copyFileSync(ext(f), web(f));
fs.copyFileSync(path.join(root, "fetcher", "worker.js"), web("fetcher-worker.js"));
fs.copyFileSync(path.join(root, "fetcher", "guide-sources.json"), web("fetcher-guide.json")); // the setup guide shows when it was last checked
for (const dir of ["engine", "vendor", "fonts", "_locales"]) {
  fs.rmSync(web(dir), { recursive: true, force: true });
  fs.cpSync(ext(dir), web(dir), { recursive: true });
}
// the LaMa inpainter is the extension's (engine/cv.js prefs.lama): 103 MB the app never loads
for (const f of ["lama.onnx", "lama.json", "LICENSE-lama.txt"]) fs.rmSync(web(path.join("vendor", f)), { force: true });
fs.mkdirSync(web("icons"), { recursive: true });
for (const f of fs.readdirSync(ext("icons"))) if (/^icon.*\.png$/.test(f)) fs.copyFileSync(ext(path.join("icons", f)), web(path.join("icons", f)));
// the app's version, from the extension's manifest (one version for both): the debug report records it
const { version } = JSON.parse(fs.readFileSync(ext("manifest.json"), "utf8"));
fs.writeFileSync(web("version.js"), `// Written by scripts/sync-shared.mjs from extension/manifest.json.\nexport const VERSION = ${JSON.stringify(version)};\n`);
console.log("synced shared files into web/");
