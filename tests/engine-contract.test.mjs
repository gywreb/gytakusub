// scripts/check-engine-contract.mjs: the repo keeps the engine's boundary, and the check
// catches each way of breaking it (on a small fake tree).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, specifiers } from "../scripts/check-engine-contract.mjs";

let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };

// the repo itself
eq(check(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")), []);

// what counts as an import (comments name engine files too, and are not imports)
eq(specifiers(`import { a } from "./engine/page.js";\nexport { b } from './x.js';\nconst m = await import("./y.js");\n// see engine/page.js\n/* import "./z.js" */\nnew Worker("./w.js"); new URL("../vendor/m.onnx", import.meta.url);`),
  ["./engine/page.js", "./x.js", "./y.js", "./w.js", "../vendor/m.onnx"]);

const tree = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-contract-"));
  for (const [p, src] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), src); }
  return root;
};
const good = {
  "extension/background.js": `import { finishPage } from "./engine/index.js";`,
  "extension/prompt.js": `import { normalizeItems } from "./engine/contract.js";`,
  "extension/engine/index.js": `export { finishPage } from "./page.js";`,
  "extension/engine/page.js": `import cv from "../vendor/opencv.js";`,
  "extension/engine/contract.js": `export const X = 1;`,
  "extension/vendor/opencv.js": ``,
};
const problems = (extra) => check(tree({ ...good, ...extra })).length;
eq(problems({}), 0);
eq(problems({ "extension/background.js": `import { finishPage } from "./engine/page.js";` }), 1); // a caller past the door
eq(problems({ "extension/options.html": `<script type="module" src="engine/layout.js"></script>` }), 1); // a page past the door
eq(problems({ "extension/engine/page.js": `import { t } from "../prompt.js";` }), 1); // the engine reaching out
eq(problems({ "extension/engine/contract.js": `import { t } from "./page.js";` }), 1); // the contract loading the engine
eq(problems({ "web/sw.js": `const SHELL = ["./engine/index.js", "./engine/contract.js"];` }), 1); // a module the offline cache lacks

console.log(`engine-contract: ${checks} checks passed`);
