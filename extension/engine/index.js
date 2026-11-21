// The engine's public entry point, for the worker that runs it (the extension's service
// worker, the web app's Web Worker). Code outside engine/ imports only this file, or
// contract.js on a thread that must not load the engine's models (the web app's page);
// scripts/check-engine-contract.mjs fails CI otherwise. A stage behind this file can then be
// replaced without touching a caller.
export { preparePage, prefillPage, finishPage, warmInpainter, inpainterWarm } from "./page.js";
export { setEnginePrefs, onLama } from "./cv.js";
export { LEFT_AS_DRAWN, normalizeItems, sliceGeometry } from "./contract.js";
