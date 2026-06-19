(function attachCutReview(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuCutReview = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createCutReview() {
  function updateCutReview(segment, action) {
    const next = { ...segment };
    if (action === "confirm") {
      next.restored = false;
      next.reviewStatus = next.reviewStatus === "confirmed" ? "unreviewed" : "confirmed";
    }
    if (action === "restore") {
      next.restored = !next.restored;
      next.reviewStatus = next.restored ? "rejected" : "unreviewed";
    }
    return next;
  }

  function cutReviewLabel(segment) {
    if (segment.restored || segment.reviewStatus === "rejected") return "已恢复保留";
    if (segment.reviewStatus === "confirmed") return "已确认删除";
    return "待复核";
  }

  return { updateCutReview, cutReviewLabel };
}));
