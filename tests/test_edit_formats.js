const assert = require("assert");
const {
  nominalFrameRate,
  secondsToTimecode,
  buildEdl
} = require("../app/edit-formats.js");

assert.strictEqual(nominalFrameRate(23.976), 24);
assert.strictEqual(nominalFrameRate(29.97), 30);
assert.strictEqual(nominalFrameRate(59.94), 60);
assert.strictEqual(secondsToTimecode(0, 30), "00:00:00:00");
assert.strictEqual(secondsToTimecode(1.5, 30), "00:00:01:15");
assert.strictEqual(secondsToTimecode(3661.5, 30), "01:01:01:15");

const edl = buildEdl({
  title: "tennis\nnight",
  fileName: "source.mp4",
  measuredFrameRate: 29.97,
  segments: [
    { start: 10, end: 12.5, reason: "first keep" },
    { start: 20, end: 23, reason: "second keep" }
  ]
});

assert.strictEqual(edl.frameRate, 30);
assert.ok(edl.text.startsWith("TITLE: tennis night\r\nFCM: NON-DROP FRAME"));
assert.ok(edl.text.includes("00:00:10:00 00:00:12:15 01:00:00:00 01:00:02:15"));
assert.ok(edl.text.includes("00:00:20:00 00:00:23:00 01:00:02:15 01:00:05:15"));
assert.ok(!edl.text.includes("\nten\nnis"));

console.log("Edit format timecode and EDL tests passed.");
