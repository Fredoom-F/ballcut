const assert = require("assert");
const {
  buildCandidateReviewMetrics,
  buildConfidenceBuckets
} = require("../app/review-metrics.js");

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

const buckets = buildConfidenceBuckets([
  { source: "opencv", reviewStatus: "confirmed", confidence: 0.9 },
  { source: "opencv", reviewStatus: "ignored", confidence: 0.85 },
  { source: "opencv", reviewStatus: "confirmed", confidence: 0.7 },
  { source: "opencv", reviewStatus: "confirmed", confidence: 0.4 },
  { source: "manual", reviewStatus: "confirmed", confidence: 0.95 }
]);
assert.strictEqual(buckets[0].reviewed, 2);
assert.strictEqual(buckets[0].precision, 0.5);
assert.strictEqual(buckets[1].precision, 1);
assert.strictEqual(buckets[2].precision, 1);

console.log("Candidate review metric tests passed.");
