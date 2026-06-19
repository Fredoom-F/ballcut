const assert = require("assert");
const {
  annotationLabel,
  buildAnnotationPayload
} = require("../app/annotation-export.js");

assert.strictEqual(annotationLabel({ source: "manual" }), "manual_hit");
assert.strictEqual(annotationLabel({ source: "opencv", reviewStatus: "confirmed" }), "confirmed_hit");
assert.strictEqual(annotationLabel({ source: "opencv", reviewStatus: "ignored" }), "false_positive");

const payload = buildAnnotationPayload({
  generatedAt: "2026-06-19T00:00:00.000Z",
  fileName: "tennis.mp4",
  fileSize: 1234,
  duration: 12,
  sport: "tennis",
  cameraAngle: "baseline",
  events: [
    {
      id: "event_1",
      timestamp: 4.5678,
      source: "opencv",
      reviewStatus: "confirmed",
      confidence: 1.5,
      position: { x: 0.4, y: 0.7 },
      evidence: { directionChangeDegrees: 130 }
    },
    { id: "invalid", timestamp: 99 }
  ]
});

assert.strictEqual(payload.schema, "jianqiu.annotations.v1");
assert.strictEqual(payload.annotations.length, 1);
assert.strictEqual(payload.annotations[0].timestamp, 4.568);
assert.strictEqual(payload.annotations[0].confidence, 1);
assert.deepStrictEqual(payload.annotations[0].position, { x: 0.4, y: 0.7 });

console.log("Annotation export tests passed.");
