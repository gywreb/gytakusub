// The engine's public entry point, for the worker that runs it (the extension's service
// worker, the web app's Web Worker). Code outside engine/ imports only this file, or
// contract.js on a thread that must not load the engine's models (the web app's page);
// scripts/check-engine-contract.mjs fails CI otherwise. A stage behind this file can then be
// replaced without touching a caller.
import * as page from "./page.js";
import { engineError } from "./cv.js";

// OpenCV's failures come out of it as bare numbers: each page step gives the caller an Error instead
const named = (step) => async (...args) => { try { return await step(...args); } catch (e) { throw engineError(e); } };
export const preparePage = named(page.preparePage), prefillPage = named(page.prefillPage), finishPage = named(page.finishPage);
export { warmInpainter, inpainterWarm } from "./page.js";
export { setEnginePrefs, onLama } from "./cv.js";
export { LEFT_AS_DRAWN, normalizeItems, sliceGeometry } from "./contract.js";
