const assert = require("assert");
const {
  mergeSegments,
  totalDuration,
  selectByDuration
} = require("../app/highlight-selection.js");

const merged = mergeSegments([
  { start: 10, end: 15, score: 0.8 },
  { start: 14.9, end: 18, score: 0.9 },
  { start: 30, end: 34, score: 0.7 }
]);
assert.deepStrictEqual(merged.map(({ start, end }) => [start, end]), [[10, 18], [30, 34]]);

const selected = selectByDuration([
  { start: 0, end: 8, score: 0.7 },
  { start: 20, end: 27, score: 0.95 },
  { start: 40, end: 46, score: 0.6, favorite: true }
], 15);
assert.ok(totalDuration(selected) <= 15.05);
assert.ok(selected.some((segment) => segment.favorite));
assert.ok(selected.some((segment) => segment.score === 0.95));

const trimmed = selectByDuration([
  { start: 10, end: 30, timestamp: 20, score: 0.9 }
], 6);
assert.strictEqual(totalDuration(trimmed), 6);
assert.deepStrictEqual([trimmed[0].start, trimmed[0].end], [17, 23]);

console.log("Highlight duration selection tests passed.");
