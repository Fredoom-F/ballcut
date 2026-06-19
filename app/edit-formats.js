(function attachEditFormats(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.JianqiuEditFormats = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createEditFormats() {
  function nominalFrameRate(measured) {
    const value = Number(measured) || 30;
    return [24, 25, 30, 50, 60].reduce((nearest, candidate) =>
      Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest
    , 30);
  }

  function secondsToTimecode(seconds, frameRate) {
    const totalFrames = Math.max(0, Math.round(Number(seconds || 0) * frameRate));
    const frames = totalFrames % frameRate;
    const totalSeconds = Math.floor(totalFrames / frameRate);
    const secs = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    return [hours, minutes, secs, frames]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function safeLine(value, maximum = 120) {
    return String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, maximum);
  }

  function buildEdl({ title, fileName, segments, measuredFrameRate }) {
    const frameRate = nominalFrameRate(measuredFrameRate);
    const safeTitle = safeLine(title, 80) || "Jianqiu";
    const safeFileName = safeLine(fileName, 180) || "source";
    const lines = [
      `TITLE: ${safeTitle}`,
      "FCM: NON-DROP FRAME",
      ""
    ];
    let recordStart = 60 * 60;
    segments.forEach((segment, index) => {
      const sourceStart = Math.max(0, Number(segment.start) || 0);
      const sourceEnd = Math.max(sourceStart, Number(segment.end) || sourceStart);
      const recordEnd = recordStart + sourceEnd - sourceStart;
      lines.push(
        `${String(index + 1).padStart(3, "0")}  AX       V     C        ` +
        `${secondsToTimecode(sourceStart, frameRate)} ${secondsToTimecode(sourceEnd, frameRate)} ` +
        `${secondsToTimecode(recordStart, frameRate)} ${secondsToTimecode(recordEnd, frameRate)}`,
        `* FROM CLIP NAME: ${safeFileName}`,
        `* JIANQIU: ${safeLine(segment.reason, 100) || "keep"}`,
        ""
      );
      recordStart = recordEnd;
    });
    return { text: lines.join("\r\n"), frameRate };
  }

  return {
    nominalFrameRate,
    secondsToTimecode,
    buildEdl
  };
}));
