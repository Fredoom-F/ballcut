const assert = require("assert");
const { buildCandidateReviewMetrics } = require("../app/review-metrics.js");

const metrics = buildCandidateReviewMetrics([
  { source: "opencv", reviewStatus: "confirmed" },
  { source: "opencv", reviewStatus: "confirmed" },
  { source: "opencv", reviewStatus: "ignored" },
  { source: "opencv", reviewStatus: "unreviewed" },
  { source: "manual", reviewStatus: "confirmed" }
]);

assert.deepStrictEqual(metrics, {
  total: 4,
  reviewed: 3,
  remaining: 1,
  confirmed: 2,
  ignored: 1,
  precision: 2 / 3,
  falsePositiveRate: 1 / 3
});

const empty = buildCandidateReviewMetrics([]);
assert.strictEqual(empty.precision, null);
assert.strictEqual(empty.falsePositiveRate, null);

console.log("Candidate review metric tests passed.");
