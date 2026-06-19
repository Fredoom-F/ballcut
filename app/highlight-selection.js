(function attachHighlightSelection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuHighlightSelection = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createHighlightSelection() {
  function mergeSegments(segments) {
    const sorted = segments
      .filter((segment) => Number(segment.end) > Number(segment.start))
      .map((segment) => ({ ...segment }))
      .sort((a, b) => a.start - b.start);
    if (!sorted.length) return [];
    const merged = [sorted[0]];
    sorted.slice(1).forEach((segment) => {
      const previous = merged[merged.length - 1];
      if (segment.start <= previous.end + 0.25) {
        previous.end = Math.max(previous.end, segment.end);
        previous.score = Math.max(Number(previous.score) || 0, Number(segment.score) || 0);
        previous.favorite = Boolean(previous.favorite || segment.favorite);
      } else {
        merged.push(segment);
      }
    });
    return merged;
  }

  function totalDuration(segments) {
    return segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  }

  function selectByDuration(candidates, maximumSeconds) {
    const limit = Number(maximumSeconds);
    const unlimited = !Number.isFinite(limit) || limit <= 0;
    const ranked = candidates
      .filter((candidate) => Number(candidate.end) > Number(candidate.start))
      .map((candidate) => ({ ...candidate }))
      .sort((a, b) =>
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        (Number(b.score) || 0) - (Number(a.score) || 0) ||
        a.start - b.start
      );
    if (unlimited) return mergeSegments(ranked);

    let selected = [];
    ranked.forEach((candidate) => {
      const trial = mergeSegments([...selected, candidate]);
      if (totalDuration(trial) <= limit + 0.05) selected = trial;
    });
    if (!selected.length && ranked.length) {
      const best = ranked[0];
      const duration = Math.min(limit, best.end - best.start);
      const center = Number(best.timestamp) || (best.start + best.end) / 2;
      const start = Math.max(best.start, center - duration / 2);
      selected = [{
        ...best,
        start: Math.min(start, best.end - duration),
        end: Math.min(best.end, Math.min(start, best.end - duration) + duration)
      }];
    }
    return mergeSegments(selected);
  }

  return {
    mergeSegments,
    totalDuration,
    selectByDuration
  };
}));
