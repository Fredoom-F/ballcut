(function attachExportReadiness(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuExportReadiness = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createExportReadiness() {
  function buildExportReadiness(options = {}) {
    const totalCandidates = Math.max(0, Number(options.totalCandidates) || 0);
    const reviewedCandidates = Math.min(
      totalCandidates,
      Math.max(0, Number(options.reviewedCandidates) || 0)
    );
    const segmentCount = Math.max(0, Number(options.segmentCount) || 0);
    const outputSeconds = Math.max(0, Number(options.outputSeconds) || 0);
    const trajectoryCoverage = Math.max(0, Number(options.trajectoryCoverage) || 0);
    const items = [];

    items.push(options.analysisReady
      ? { key: "analysis", level: "ready", label: "分析结果", detail: "本机分析结果已载入" }
      : { key: "analysis", level: "error", label: "分析结果", detail: "请先完成本地分析" });

    items.push(segmentCount > 0 && outputSeconds > 0
      ? {
        key: "segments",
        level: "ready",
        label: "导出片段",
        detail: `${segmentCount} 段，预计成片 ${Math.round(outputSeconds)} 秒`
      }
      : { key: "segments", level: "error", label: "导出片段", detail: "当前没有可导出片段" });

    const remaining = totalCandidates - reviewedCandidates;
    items.push(totalCandidates === 0
      ? { key: "review", level: "warning", label: "候选复核", detail: "没有识别到击球候选，请检查素材与参数" }
      : remaining === 0
        ? { key: "review", level: "ready", label: "候选复核", detail: `${totalCandidates} 个候选已全部复核` }
        : {
          key: "review",
          level: "warning",
          label: "候选复核",
          detail: `仍有 ${remaining} / ${totalCandidates} 个候选未复核`
        });

    items.push(trajectoryCoverage >= 0.15
      ? {
        key: "trajectory",
        level: "ready",
        label: "轨迹证据",
        detail: `覆盖率 ${Math.round(trajectoryCoverage * 100)}%`
      }
      : {
        key: "trajectory",
        level: "warning",
        label: "轨迹证据",
        detail: `覆盖率 ${Math.round(trajectoryCoverage * 100)}%，建议抽查击球位置`
      });

    items.push(options.mediaRecorderSupported
      ? { key: "format", level: "ready", label: "浏览器导出", detail: "可生成带水印 WebM 预览" }
      : { key: "format", level: "error", label: "浏览器导出", detail: "当前浏览器不支持本地视频录制" });

    if (options.audioRequested) {
      items.push(options.audioSupported
        ? { key: "audio", level: "ready", label: "原声音轨", detail: "浏览器支持保留原声" }
        : { key: "audio", level: "warning", label: "原声音轨", detail: "当前浏览器可能只能导出静音视频" });
    }

    const errors = items.filter((item) => item.level === "error").length;
    const warnings = items.filter((item) => item.level === "warning").length;
    return {
      level: errors ? "error" : warnings ? "warning" : "ready",
      errors,
      warnings,
      items
    };
  }

  return { buildExportReadiness };
}));
