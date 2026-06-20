(function attachImpactTrail(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuImpactTrail = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createImpactTrail() {
  function getPostImpactTrail(trajectory, events, currentTime, options = {}) {
    const trailSeconds = Number(options.trailSeconds) || 1.2;
    const maxPoints = Math.max(2, Number(options.maxPoints) || 18);
    const maximumGap = Number(options.maximumGap) || 0.35;
    const maximumJump = Number(options.maximumJump) || 0.22;
    const impact = events
      .filter((event) =>
        event &&
        event.reviewStatus !== "ignored" &&
        Number(event.timestamp) <= currentTime &&
        currentTime - Number(event.timestamp) <= trailSeconds
      )
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
    if (!impact) return [];

    const candidates = trajectory
      .filter((point) =>
        Number(point.time) >= Number(impact.timestamp) - 0.001 &&
        Number(point.time) <= currentTime
      )
      .sort((a, b) => Number(a.time) - Number(b.time));
    const continuous = [];
    for (const point of candidates) {
      const previous = continuous[continuous.length - 1];
      if (previous) {
        const gap = Number(point.time) - Number(previous.time);
        const jump = Math.hypot(
          Number(point.xNorm) - Number(previous.xNorm),
          Number(point.yNorm) - Number(previous.yNorm)
        );
        if (gap > maximumGap || jump > maximumJump) break;
      }
      continuous.push(point);
    }
    return continuous.slice(-maxPoints);
  }

  return { getPostImpactTrail };
}));
