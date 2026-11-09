// Copies the files the web app shares with the extension (extension/ is
// canonical) into web/. Cross-platform: node scripts/sync-shared.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = (p) => path.join(root, "extension", p), web = (p) => path.join(root, "web", p);

for (const f of ["prompt.js", "text.js", "LICENSE", "THIRD_PARTY.md"]) fs.copyFileSync(ext(f), web(f));
for (const dir of ["engine", "vendor", "fonts"]) {
  fs.rmSync(web(dir), { recursive: true, force: true });
  fs.cpSync(ext(dir), web(dir), { recursive: true });
}
fs.mkdirSync(web("icons"), { recursive: true });
for (const f of fs.readdirSync(ext("icons"))) if (/^icon.*\.png$/.test(f)) fs.copyFileSync(ext(path.join("icons", f)), web(path.join("icons", f)));
console.log("synced shared files into web/");
