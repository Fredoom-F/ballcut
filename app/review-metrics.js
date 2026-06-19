(function attachReviewMetrics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuReviewMetrics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createReviewMetrics() {
  function buildCandidateReviewMetrics(events = []) {
    const candidates = events.filter((event) => event && event.source !== "manual");
    const confirmed = candidates.filter((event) => event.reviewStatus === "confirmed").length;
    const ignored = candidates.filter((event) => event.reviewStatus === "ignored").length;
    const reviewed = confirmed + ignored;
    return {
      total: candidates.length,
      reviewed,
      remaining: Math.max(0, candidates.length - reviewed),
      confirmed,
      ignored,
      precision: reviewed ? confirmed / reviewed : null,
      falsePositiveRate: reviewed ? ignored / reviewed : null
    };
  }

  function buildConfidenceBuckets(events = []) {
    const definitions = [
      { key: "high", label: "高分 80–100", minimum: 0.8, maximum: 1.01 },
      { key: "medium", label: "中分 60–79", minimum: 0.6, maximum: 0.8 },
      { key: "low", label: "低分 0–59", minimum: 0, maximum: 0.6 }
    ];
    return definitions.map((definition) => {
      const candidates = events.filter((event) => {
        const confidence = Number(event?.confidence) || 0;
        return event?.source !== "manual" &&
          confidence >= definition.minimum &&
          confidence < definition.maximum;
      });
      const metrics = buildCandidateReviewMetrics(candidates);
      return {
        key: definition.key,
        label: definition.label,
        ...metrics
      };
    });
  }

  return { buildCandidateReviewMetrics, buildConfidenceBuckets };
}));
