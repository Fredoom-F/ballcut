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

  return { buildCandidateReviewMetrics };
}));
