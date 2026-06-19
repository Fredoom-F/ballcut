(function attachLocalBackup(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuLocalBackup = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createLocalBackup() {
  function clampNumber(value, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return minimum;
    return Math.min(maximum, Math.max(minimum, numeric));
  }

  function sanitizeSummary(summary = {}) {
    const candidate = summary.candidateReview || {};
    return {
      sport: String(summary.sport || "").slice(0, 30),
      duration: clampNumber(summary.duration, 0, 24 * 60 * 60),
      activeEvents: Math.round(clampNumber(summary.activeEvents, 0, 100000)),
      longestSequence: Math.round(clampNumber(summary.longestSequence, 0, 100000)),
      keptRatio: clampNumber(summary.keptRatio, 0, 1),
      reviewRate: clampNumber(summary.reviewRate, 0, 1),
      trustScore: clampNumber(summary.trustScore, 0, 1),
      trustLabel: String(summary.trustLabel || "需复核").slice(0, 20),
      trajectoryCoverage: clampNumber(summary.trajectoryCoverage, 0, 1),
      cameraStability: clampNumber(summary.cameraStability, 0, 1),
      removedDuration: clampNumber(summary.removedDuration, 0, 24 * 60 * 60),
      generatedAt: String(summary.generatedAt || "").slice(0, 40),
      candidateReview: {
        total: Math.round(clampNumber(candidate.total, 0, 100000)),
        reviewed: Math.round(clampNumber(candidate.reviewed, 0, 100000)),
        confirmed: Math.round(clampNumber(candidate.confirmed, 0, 100000)),
        ignored: Math.round(clampNumber(candidate.ignored, 0, 100000)),
        precision: candidate.precision == null ? null : clampNumber(candidate.precision, 0, 1)
      }
    };
  }

  function createLocalBackup(options = {}) {
    return {
      schema: "jianqiu.local-backup.v1",
      generated_at: options.generatedAt || new Date().toISOString(),
      contains_video: false,
      preferences: options.preferences || {},
      training_history: Array.isArray(options.history) ? options.history : []
    };
  }

  function validateLocalBackup(payload, allowedPreferenceKeys = []) {
    if (!payload || payload.schema !== "jianqiu.local-backup.v1") {
      throw new Error("不是支持的剪球本机备份文件");
    }
    const allowed = new Set(allowedPreferenceKeys);
    const preferences = {};
    Object.entries(payload.preferences || {}).forEach(([key, value]) => {
      if (!allowed.has(key)) return;
      if (typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
        preferences[key] = value;
      }
    });
    const history = (Array.isArray(payload.training_history) ? payload.training_history : [])
      .slice(0, 100)
      .filter((item) => item && item.key && item.summary)
      .map((item) => ({
        key: String(item.key).slice(0, 500),
        fileName: String(item.fileName || "未命名视频").slice(0, 200),
        sport: String(item.sport || "tennis").slice(0, 30),
        updatedAt: clampNumber(item.updatedAt, 0, Date.now() + 24 * 60 * 60 * 1000),
        summary: sanitizeSummary(item.summary)
      }));
    return { preferences, history };
  }

  return { createLocalBackup, validateLocalBackup };
}));
