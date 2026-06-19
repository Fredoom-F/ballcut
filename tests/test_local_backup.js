const assert = require("assert");
const {
  createLocalBackup,
  validateLocalBackup
} = require("../app/local-backup.js");

const payload = createLocalBackup({
  generatedAt: "2026-06-19T00:00:00.000Z",
  preferences: { sportSelect: "tennis", unknown: "drop" },
  history: [{
    key: "history-1",
    fileName: "training.mp4",
    sport: "tennis",
    updatedAt: 1000,
    summary: {
      duration: 60,
      activeEvents: 12,
      longestSequence: 5,
      keptRatio: 0.8,
      candidateReview: { total: 10, reviewed: 8, confirmed: 6, ignored: 2, precision: 0.75 }
    }
  }]
});

assert.strictEqual(payload.contains_video, false);
const restored = validateLocalBackup(payload, ["sportSelect"]);
assert.deepStrictEqual(restored.preferences, { sportSelect: "tennis" });
assert.strictEqual(restored.history.length, 1);
assert.strictEqual(restored.history[0].summary.candidateReview.precision, 0.75);

assert.throws(
  () => validateLocalBackup({ schema: "unknown" }, []),
  /不是支持的/
);

console.log("Local backup format tests passed.");
