// The engine's boundary, checked in CI (docs/ARCHITECTURE.md, "Engine boundary"):
//  1. code outside engine/ imports only engine/index.js, or engine/contract.js;
//  2. the engine imports nothing outside engine/ but vendor/ (its models and libraries);
//  3. engine/contract.js imports nothing, so a thread that must not load the models can use it;
//  4. the web app's offline cache (web/sw.js) lists every engine module.
// A stage behind index.js can then be replaced without touching a caller.
//   node scripts/check-engine-contract.mjs [root]   (exit 1 and a list when anything breaks)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = new Set(["index.js", "contract.js"]);

/** Every module specifier a file names: static and dynamic imports, re-exports, workers, URLs. */
export function specifiers(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1"); // comments carry engine/… paths
  const out = [];
  const patterns = [
    /\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\bnew\s+(?:Shared)?Worker\(\s*["']([^"']+)["']/g,
    /\bimportScripts\(\s*["']([^"']+)["']/g,
    /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

const walk = (dir, skip) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (skip.some((s) => p === s)) return [];
    return e.isDirectory() ? walk(p, skip) : /\.(m?js|html)$/.test(e.name) ? [p] : [];
  });
};

/** @returns {string[]} what breaks the boundary under `root` (empty: nothing) */
export function check(root) {
  const problems = [];
  const rel = (p) => path.relative(root, p).split(path.sep).join("/");
  for (const app of ["extension", "web"]) {
    const base = path.join(root, app), engine = path.join(base, "engine"), vendor = path.join(base, "vendor");
    if (!fs.existsSync(engine)) continue;

    // 1. callers
    for (const file of walk(base, [engine, vendor, path.join(base, "node_modules")])) {
      const src = fs.readFileSync(file, "utf8");
      const specs = file.endsWith(".html") ? [...src.matchAll(/\bsrc=["']([^"']+)["']/g)].map((m) => m[1]) : specifiers(src);
      for (const s of specs) {
        if (/^([a-z][\w+.-]*:|\/|#)/i.test(s)) continue; // a URL or an absolute path: not a module of ours
        const target = path.resolve(path.dirname(file), s);
        if (path.dirname(target) === engine ? !PUBLIC.has(path.basename(target)) : target.startsWith(engine + path.sep))
          problems.push(`${rel(file)} imports ${s}: outside the engine, import only engine/index.js (or engine/contract.js)`);
      }
    }

    // 2. and 3. the engine itself
    for (const file of walk(engine, [])) {
      const specs = specifiers(fs.readFileSync(file, "utf8"));
      if (path.basename(file) === "contract.js" && specs.length) problems.push(`${rel(file)} imports ${specs.join(", ")}: the contract imports nothing`);
      for (const s of specs) {
        if (!s.startsWith(".")) { problems.push(`${rel(file)} imports ${s}: the engine imports only its own files and vendor/`); continue; }
        const target = path.resolve(path.dirname(file), s);
        if (!target.startsWith(engine + path.sep) && !target.startsWith(vendor + path.sep) && target !== vendor)
          problems.push(`${rel(file)} imports ${s}: the engine imports only its own files and vendor/`);
      }
    }
  }

  // 4. the web app works offline only if its cache holds every engine module
  const sw = path.join(root, "web", "sw.js");
  const modules = path.join(root, "extension", "engine"); // web/engine/ is its copy (scripts/sync-shared.mjs), absent until synced
  if (fs.existsSync(sw) && fs.existsSync(modules)) {
    const shell = fs.readFileSync(sw, "utf8");
    for (const f of fs.readdirSync(modules).filter((f) => f.endsWith(".js")))
      if (!shell.includes(`"./engine/${f}"`)) problems.push(`web/sw.js: SHELL lacks "./engine/${f}", so the web app cannot load it offline`);
  }

  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = check(path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..")));
  if (problems.length) {
    for (const p of problems) console.error("::error::" + p);
    process.exit(1);
  }
  console.log("engine boundary: callers use engine/index.js or engine/contract.js; the engine imports only itself and vendor/");
}
