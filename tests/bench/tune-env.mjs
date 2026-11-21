// Imported first by the bench scripts: GYT_TUNE='{"LAYOUT":{"adoptMaxLetter":5}}' changes engine
// tuning values (extension/engine/tuning.js) for one run, to see what a result hangs on.
if (process.env.GYT_TUNE) {
  globalThis.GYT_TUNE = JSON.parse(process.env.GYT_TUNE);
  console.error("bench: tuning changed:", process.env.GYT_TUNE);
}
