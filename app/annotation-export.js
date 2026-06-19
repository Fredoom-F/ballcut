(function attachAnnotationExport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuAnnotationExport = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createAnnotationExport() {
  function annotationLabel(event) {
    if (event.source === "manual") return "manual_hit";
    if (event.reviewStatus === "confirmed") return "confirmed_hit";
    if (event.reviewStatus === "ignored") return "false_positive";
    return "unreviewed_candidate";
  }

  function buildAnnotationPayload(options = {}) {
    const duration = Math.max(0, Number(options.duration) || 0);
    const events = Array.isArray(options.events) ? options.events : [];
    return {
      schema: "jianqiu.annotations.v1",
      generated_at: options.generatedAt || new Date().toISOString(),
      source: {
        file_name: String(options.fileName || "").slice(0, 200),
        file_size: Math.max(0, Number(options.fileSize) || 0),
        duration,
        sport: String(options.sport || ""),
        camera_angle: String(options.cameraAngle || "")
      },
      coordinate_system: "normalized_video_frame",
      annotations: events
        .filter((event) =>
          event &&
          Number.isFinite(Number(event.timestamp)) &&
          Number(event.timestamp) >= 0 &&
          (!duration || Number(event.timestamp) <= duration + 1)
        )
        .map((event) => ({
          id: String(event.id || ""),
          timestamp: Number(Number(event.timestamp).toFixed(3)),
          label: annotationLabel(event),
          shot_type: String(event.shotType || "unclassified"),
          confidence: Math.max(0, Math.min(1, Number(event.confidence) || 0)),
          position: event.position && Number.isFinite(Number(event.position.x)) && Number.isFinite(Number(event.position.y))
            ? {
              x: Math.max(0, Math.min(1, Number(event.position.x))),
              y: Math.max(0, Math.min(1, Number(event.position.y)))
            }
            : null,
          evidence: event.evidence || null,
          note: String(event.note || "").slice(0, 200)
        }))
    };
  }

  return { annotationLabel, buildAnnotationPayload };
}));
