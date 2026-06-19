const assert = require("assert");
const {
  updateCutReview,
  cutReviewLabel
} = require("../app/cut-review.js");

const original = { id: "cut_1", restored: false, reviewStatus: "unreviewed" };
const confirmed = updateCutReview(original, "confirm");
assert.strictEqual(confirmed.reviewStatus, "confirmed");
assert.strictEqual(confirmed.restored, false);
assert.strictEqual(cutReviewLabel(confirmed), "已确认删除");

const unconfirmed = updateCutReview(confirmed, "confirm");
assert.strictEqual(unconfirmed.reviewStatus, "unreviewed");

const restored = updateCutReview(confirmed, "restore");
assert.strictEqual(restored.reviewStatus, "rejected");
assert.strictEqual(restored.restored, true);
assert.strictEqual(cutReviewLabel(restored), "已恢复保留");

const returned = updateCutReview(restored, "restore");
assert.strictEqual(returned.reviewStatus, "unreviewed");
assert.strictEqual(returned.restored, false);
assert.strictEqual(cutReviewLabel(returned), "待复核");
assert.strictEqual(original.reviewStatus, "unreviewed");

console.log("Cut review state tests passed.");
