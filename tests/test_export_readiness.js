const assert = require("assert");
const { buildExportReadiness } = require("../app/export-readiness.js");

const ready = buildExportReadiness({
  analysisReady: true,
  totalCandidates: 8,
  reviewedCandidates: 8,
  segmentCount: 3,
  outputSeconds: 28,
  trajectoryCoverage: 0.42,
  cutSegments: 2,
  reviewedCutSegments: 2,
  mediaRecorderSupported: true,
  audioRequested: true,
  audioSupported: true
});
assert.strictEqual(ready.level, "ready");
assert.strictEqual(ready.errors, 0);
assert.strictEqual(ready.warnings, 0);

const warning = buildExportReadiness({
  analysisReady: true,
  totalCandidates: 8,
  reviewedCandidates: 3,
  segmentCount: 2,
  outputSeconds: 15,
  trajectoryCoverage: 0.08,
  cutSegments: 3,
  reviewedCutSegments: 1,
  mediaRecorderSupported: true,
  audioRequested: true,
  audioSupported: false
});
assert.strictEqual(warning.level, "warning");
assert.strictEqual(warning.errors, 0);
assert.ok(warning.warnings >= 4);
assert.ok(warning.items.some((item) => item.detail.includes("5 / 8")));
assert.ok(warning.items.some((item) => item.detail.includes("2 / 3")));

const blocked = buildExportReadiness({
  analysisReady: false,
  segmentCount: 0,
  outputSeconds: 0,
  mediaRecorderSupported: false
});
assert.strictEqual(blocked.level, "error");
assert.strictEqual(blocked.errors, 3);

console.log("Export readiness tests passed.");
