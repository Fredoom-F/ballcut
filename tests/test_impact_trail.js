const assert = require("assert");
const { getPostImpactTrail } = require("../app/impact-trail.js");

const trajectory = [
  { time: 4.7, xNorm: 0.4, yNorm: 0.2 },
  { time: 4.9, xNorm: 0.42, yNorm: 0.3 },
  { time: 5.0, xNorm: 0.44, yNorm: 0.4 },
  { time: 5.1, xNorm: 0.5, yNorm: 0.45 },
  { time: 5.2, xNorm: 0.58, yNorm: 0.5 },
  { time: 5.3, xNorm: 0.95, yNorm: 0.05 }
];
const events = [{ timestamp: 5.0, reviewStatus: "confirmed" }];
const trail = getPostImpactTrail(trajectory, events, 5.4, { maxPoints: 10 });

assert.deepStrictEqual(trail.map((point) => point.time), [5.0, 5.1, 5.2]);
assert.ok(trail.every((point) => point.time >= 5.0), "toss points must not be drawn");
assert.ok(!trail.some((point) => point.time === 5.3), "large background-light jump must break trail");
assert.deepStrictEqual(
  getPostImpactTrail(trajectory, events, 7.0),
  [],
  "trail should disappear after the post-impact window"
);

console.log("Post-impact trajectory tests passed.");
