const state = {
  file: null,
  url: "",
  duration: 0,
  events: [],
  segments: [],
  highlights: [],
  trajectory: [],
  analysisQuality: null,
  restored: false,
  raf: 0,
  analyzing: false
};

const sportProfiles = {
  tennis: { name: "网球", event: "击球", interval: 7.5, idle: "捡球/发球准备", color: "#f6c85f" },
  badminton: { name: "羽毛球", event: "击球", interval: 5.4, idle: "捡球/站位调整", color: "#dff7ff" },
  tabletennis: { name: "乒乓球", event: "击球", interval: 3.2, idle: "捡球/擦汗等待", color: "#ff8a5b" },
  basketball: { name: "篮球", event: "关键动作", interval: 8.8, idle: "发球/走位等待", color: "#ff9f43" },
  football: { name: "足球", event: "触球", interval: 10.5, idle: "无推进等待", color: "#7aa7ff" },
  golf: { name: "高尔夫", event: "挥杆", interval: 18, idle: "走位/准备击球", color: "#4cc9a4" }
};

const $ = (id) => document.getElementById(id);
const video = $("sourceVideo");
const canvas = $("effectCanvas");
const ctx = canvas.getContext("2d");

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setLog(lines) {
  $("progressLog").innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
}

function selectFile(file) {
  if (!file || !file.type.startsWith("video/")) return;
  if (state.url) URL.revokeObjectURL(state.url);
  state.file = file;
  state.url = URL.createObjectURL(file);
  video.src = state.url;
  $("fileName").textContent = file.name;
  $("analyzeBtn").disabled = false;
  $("exportBtn").disabled = true;
  $("decisionBtn").disabled = true;
  $("restoreBtn").disabled = true;
  state.events = [];
  state.segments = [];
  state.highlights = [];
  state.trajectory = [];
  state.analysisQuality = null;
  renderAll();
  setLog(["视频已载入，等待读取时长。", "本地模式不会把文件发送到网络。"]);
}

async function generateAnalysis() {
  if (!state.file || state.analyzing) return;
  const sport = $("sportSelect").value;
  const profile = sportProfiles[sport];
  const strength = Number($("cutStrength").value);
  state.analyzing = true;
  $("analyzeBtn").disabled = true;
  $("analyzeBtn").textContent = "OpenCV 正在逐帧分析...";
  setLog([
    `正在分析 ${profile.name} 视频真实帧。`,
    "检测运动区域、球色候选、连续轨迹以及方向/速度突变。",
    "长视频可能需要数分钟，请保持本地服务窗口开启。"
  ]);

  try {
    const response = await fetch(`/api/analyze?sport=${encodeURIComponent(sport)}&strength=${strength}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: state.file
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "本地分析失败");

    state.duration = result.duration || state.duration;
    state.events = result.events || [];
    state.segments = result.segments || [];
    state.highlights = result.highlights || [];
    state.trajectory = result.trajectory || [];
    state.analysisQuality = result.quality || null;
    state.restored = false;

    const coverage = Math.round((result.quality?.coverage || 0) * 100);
    const messages = [
      `完成 ${result.sportName || profile.name} OpenCV 本地分析。`,
      `追踪到 ${state.trajectory.length} 个真实球位置，轨迹覆盖约 ${coverage}%。`,
      `检测到 ${state.events.length} 个疑似击球，生成 ${state.highlights.length} 个候选精彩片段。`
    ];
    if (result.quality?.warning) messages.push(result.quality.warning);
    setLog(messages);
    $("exportBtn").disabled = false;
    $("decisionBtn").disabled = false;
    $("restoreBtn").disabled = false;
    renderAll();
  } catch (error) {
    state.events = [];
    state.segments = [{ id: "keep_0", start: 0, end: state.duration, type: "keep" }];
    state.highlights = [];
    state.trajectory = [];
    setLog(["分析失败，没有生成模拟结果。", error.message]);
    renderAll();
  } finally {
    state.analyzing = false;
    $("analyzeBtn").disabled = false;
    $("analyzeBtn").textContent = "开始本地分析";
  }
}

function getRemovedDuration() {
  if (state.restored) return 0;
  return state.segments.filter((s) => s.type === "remove").reduce((sum, s) => sum + s.end - s.start, 0);
}

function getKeptSegments() {
  if (state.restored) return [{ start: 0, end: state.duration, type: "keep" }];
  return state.segments.filter((segment) => segment.type === "keep" && segment.end > segment.start);
}

function renderTimeline() {
  const timeline = $("timeline");
  timeline.innerHTML = "";
  if (!state.duration) return;

  const fragment = document.createDocumentFragment();
  state.segments.forEach((segment) => {
    const div = document.createElement("button");
    div.type = "button";
    div.className = `segment ${state.restored && segment.type === "remove" ? "keep" : segment.type}`;
    div.style.left = `${(segment.start / state.duration) * 100}%`;
    div.style.width = `${Math.max(0.35, ((segment.end - segment.start) / state.duration) * 100)}%`;
    div.title = `${segment.type === "remove" ? segment.reason : "保留片段"} ${formatTime(segment.start)}-${formatTime(segment.end)}`;
    fragment.appendChild(div);
  });

  state.highlights.forEach((highlight) => {
    const div = document.createElement("div");
    div.className = "segment highlight";
    div.style.left = `${(highlight.start / state.duration) * 100}%`;
    div.style.width = `${Math.max(0.4, ((highlight.end - highlight.start) / state.duration) * 100)}%`;
    fragment.appendChild(div);
  });

  state.events.forEach((event) => {
    const marker = document.createElement("div");
    marker.className = "event-marker";
    marker.style.left = `${(event.timestamp / state.duration) * 100}%`;
    marker.title = `${event.label} ${formatTime(event.timestamp)}`;
    fragment.appendChild(marker);
  });

  const playhead = document.createElement("div");
  playhead.id = "timelinePlayhead";
  playhead.className = "timeline-playhead";
  playhead.style.left = `${state.duration ? (video.currentTime / state.duration) * 100 : 0}%`;
  fragment.appendChild(playhead);

  timeline.appendChild(fragment);
}

function renderEvents() {
  const list = $("eventList");
  list.innerHTML = "";
  if (!state.events.length) {
    list.innerHTML = '<div class="event-card"><span>暂无识别结果。</span></div>';
    return;
  }

  state.events.slice(0, 24).forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    card.innerHTML = `
      <div>
        <strong>${event.label}</strong>
        <span>${formatTime(event.timestamp)} · 置信度 ${Math.round(event.confidence * 100)}%</span>
        <span>${formatEvidence(event.evidence)}</span>
      </div>
      <button type="button">定位</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      video.currentTime = event.timestamp;
      video.play();
    });
    list.appendChild(card);
  });
}

function formatEvidence(evidence) {
  if (!evidence) return "无可用证据";
  return `方向变化 ${evidence.directionChangeDegrees}° · 速度 ${evidence.speedBeforePxPerSec}→${evidence.speedAfterPxPerSec}px/s · 连续度 ${Math.round(evidence.trackContinuity * 100)}%`;
}

function renderMetrics() {
  const kept = state.duration - getRemovedDuration();
  $("durationLabel").textContent = `${formatTime(video.currentTime)} / ${formatTime(state.duration)}`;
  $("metricOriginal").textContent = state.duration ? formatTime(state.duration) : "--";
  $("metricKept").textContent = state.duration ? formatTime(kept) : "--";
  $("metricEvents").textContent = state.events.length ? String(state.events.length) : "--";
  $("metricHighlights").textContent = state.highlights.length ? String(state.highlights.length) : "--";
}

function renderAll() {
  renderTimeline();
  renderEvents();
  renderMetrics();
}

function sizeCanvasToVideo() {
  const rect = video.getBoundingClientRect();
  const parentRect = video.parentElement.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  canvas.style.left = `${rect.left - parentRect.left}px`;
  canvas.style.top = `${rect.top - parentRect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function drawEffects() {
  sizeCanvasToVideo();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.events.length || video.paused || video.ended) {
    state.raf = requestAnimationFrame(drawEffects);
    return;
  }

  const profile = sportProfiles[$("sportSelect").value];
  const now = video.currentTime;
  const recent = state.events.filter((event) => Math.abs(event.timestamp - now) < 0.65 && event.position);
  recent.forEach((event) => {
    const age = Math.abs(event.timestamp - now);
    const pulse = 1 - age / 0.65;
    const x = canvas.width * event.position.x;
    const y = canvas.height * event.position.y;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = profile.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, 26 + 58 * (1 - pulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = profile.color;
    ctx.beginPath();
    ctx.arc(x, y, 7 + 10 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  const trail = state.trajectory.filter((point) => point.time <= now && now - point.time < 1.2).slice(-18);
  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = profile.color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    trail.forEach((point, index) => {
      const x = canvas.width * point.xNorm;
      const y = canvas.height * point.yNorm;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }
  trail.forEach((point, index) => {
    const x = canvas.width * point.xNorm;
    const y = canvas.height * point.yNorm;
    ctx.save();
    ctx.globalAlpha = (index + 1) / Math.max(2, trail.length + 2);
    ctx.fillStyle = profile.color;
    ctx.beginPath();
    ctx.arc(x, y, 4 + index, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  state.raf = requestAnimationFrame(drawEffects);
}

function skipRemovedSegments() {
  if (!$("smartSkip").checked || state.restored || !state.segments.length || video.paused) return;
  const cut = state.segments.find((segment) => segment.type === "remove" && video.currentTime >= segment.start && video.currentTime < segment.end - 0.08);
  if (cut) video.currentTime = cut.end;
}

function updatePlaybackProgress() {
  const progress = state.duration ? clamp(video.currentTime / state.duration, 0, 1) : 0;
  const playhead = $("timelinePlayhead");
  if (playhead) playhead.style.left = `${progress * 100}%`;
  $("durationLabel").textContent = `${formatTime(video.currentTime)} / ${formatTime(state.duration)}`;
}

function makeDecisionPayload() {
  return {
    app: "剪球 MVP",
    local_only: true,
    source_file: state.file?.name || "",
    duration: state.duration,
    sport: $("sportSelect").value,
    mode: $("modeSelect").value,
    ratio: $("ratioSelect").value,
    events: state.events,
    segments: state.segments,
    highlights: state.highlights
    ,
    trajectory: state.trajectory,
    analysis_quality: state.analysisQuality
  };
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function waitForSeek(targetVideo, time) {
  return new Promise((resolve) => {
    const done = () => {
      targetVideo.removeEventListener("seeked", done);
      resolve();
    };
    targetVideo.addEventListener("seeked", done);
    targetVideo.currentTime = time;
  });
}

async function exportPreview() {
  if (!state.file || !state.duration) return;
  const kept = getKeptSegments().slice(0, 10);
  const exportVideo = document.createElement("video");
  exportVideo.src = state.url;
  exportVideo.muted = true;
  exportVideo.playsInline = true;
  await new Promise((resolve) => exportVideo.addEventListener("loadedmetadata", resolve, { once: true }));

  const out = document.createElement("canvas");
  const ratio = $("ratioSelect").value;
  const sourceW = exportVideo.videoWidth || 1280;
  const sourceH = exportVideo.videoHeight || 720;
  const dims = getOutputSize(sourceW, sourceH, ratio);
  out.width = dims.width;
  out.height = dims.height;
  const outCtx = out.getContext("2d");
  const stream = out.captureStream(30);
  const recorder = new MediaRecorder(stream, getRecorderOptions(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]));
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  setLog(["正在导出带水印预览。", "本地浏览器会录制保留片段，最长导出前 10 个片段。"]);
  recorder.start();

  for (const segment of kept) {
    await waitForSeek(exportVideo, segment.start);
    await exportVideo.play();
    await drawExportSegment(exportVideo, outCtx, out, segment.end);
    exportVideo.pause();
  }

  recorder.stop();
  await new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  const blob = new Blob(chunks, { type: "video/webm" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `jianqiu-preview-${Date.now()}.webm`;
  link.click();
  URL.revokeObjectURL(url);
  setLog(["导出完成。", "当前 MVP 导出 WebM 水印预览；高清 MP4 可在接入 FFmpeg 后启用。"]);
}

async function createDemoVideo() {
  if (!window.MediaRecorder) {
    setLog(["当前浏览器不支持本地视频生成。", "请直接上传一段手机拍摄的视频继续测试。"]);
    return;
  }

  const demoCanvas = document.createElement("canvas");
  demoCanvas.width = 960;
  demoCanvas.height = 540;
  const demoCtx = demoCanvas.getContext("2d");
  const stream = demoCanvas.captureStream(30);
  const recorder = new MediaRecorder(stream, getRecorderOptions(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]));
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  setLog(["正在生成本地演示视频。", "这段素材只用于测试剪球流程，不会写入云端。"]);
  recorder.start();
  const started = performance.now();
  const durationMs = 9000;

  await new Promise((resolve) => {
    const draw = (now) => {
      const elapsed = now - started;
      const t = elapsed / 1000;
      demoCtx.fillStyle = "#11322b";
      demoCtx.fillRect(0, 0, demoCanvas.width, demoCanvas.height);
      demoCtx.strokeStyle = "rgba(255,255,255,.7)";
      demoCtx.lineWidth = 5;
      demoCtx.strokeRect(84, 72, 792, 396);
      demoCtx.beginPath();
      demoCtx.moveTo(480, 72);
      demoCtx.lineTo(480, 468);
      demoCtx.stroke();

      const playerA = { x: 250 + Math.sin(t * 2.1) * 42, y: 310 + Math.cos(t * 1.4) * 30 };
      const playerB = { x: 700 + Math.cos(t * 1.8) * 42, y: 228 + Math.sin(t * 1.2) * 25 };
      drawPlayer(demoCtx, playerA.x, playerA.y, "#f4f7f8");
      drawPlayer(demoCtx, playerB.x, playerB.y, "#7aa7ff");

      const phase = (t % 3) / 3;
      const direction = Math.floor(t / 3) % 2 === 0 ? 1 : -1;
      const ballX = direction === 1 ? 280 + phase * 400 : 680 - phase * 400;
      const ballY = 270 + Math.sin(phase * Math.PI) * -90;
      demoCtx.fillStyle = "#f6c85f";
      demoCtx.beginPath();
      demoCtx.arc(ballX, ballY, 10, 0, Math.PI * 2);
      demoCtx.fill();

      demoCtx.fillStyle = "rgba(255,255,255,.82)";
      demoCtx.font = "700 26px sans-serif";
      demoCtx.fillText("剪球演示素材", 28, 44);

      if (elapsed >= durationMs) {
        resolve();
        return;
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });

  recorder.stop();
  await new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  const blob = new Blob(chunks, { type: "video/webm" });
  const file = new File([blob], "jianqiu-demo.webm", { type: "video/webm" });
  selectFile(file);
}

function drawPlayer(targetCtx, x, y, color) {
  targetCtx.strokeStyle = color;
  targetCtx.fillStyle = color;
  targetCtx.lineWidth = 8;
  targetCtx.lineCap = "round";
  targetCtx.beginPath();
  targetCtx.arc(x, y - 54, 16, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.beginPath();
  targetCtx.moveTo(x, y - 35);
  targetCtx.lineTo(x, y + 18);
  targetCtx.moveTo(x, y - 12);
  targetCtx.lineTo(x + 38, y - 34);
  targetCtx.moveTo(x, y + 18);
  targetCtx.lineTo(x - 28, y + 66);
  targetCtx.moveTo(x, y + 18);
  targetCtx.lineTo(x + 30, y + 64);
  targetCtx.stroke();
  targetCtx.strokeStyle = "#f6c85f";
  targetCtx.lineWidth = 4;
  targetCtx.beginPath();
  targetCtx.moveTo(x + 38, y - 34);
  targetCtx.lineTo(x + 68, y - 52);
  targetCtx.stroke();
}

function getOutputSize(sourceW, sourceH, ratio) {
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  if (ratio === "4:5") return { width: 864, height: 1080 };
  if (ratio === "16:9") return { width: 1280, height: 720 };
  const scale = Math.min(1280 / sourceW, 720 / sourceH, 1);
  return { width: Math.round(sourceW * scale), height: Math.round(sourceH * scale) };
}

function getRecorderOptions(candidates) {
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

function drawExportSegment(exportVideo, outCtx, out, end) {
  return new Promise((resolve) => {
    const profile = sportProfiles[$("sportSelect").value];
    const draw = () => {
      if (exportVideo.currentTime >= end || exportVideo.ended) {
        resolve();
        return;
      }

      outCtx.fillStyle = "#050607";
      outCtx.fillRect(0, 0, out.width, out.height);
      const scale = Math.min(out.width / exportVideo.videoWidth, out.height / exportVideo.videoHeight);
      const w = exportVideo.videoWidth * scale;
      const h = exportVideo.videoHeight * scale;
      const x = (out.width - w) / 2;
      const y = (out.height - h) / 2;
      outCtx.drawImage(exportVideo, x, y, w, h);

      state.events
        .filter((event) => Math.abs(event.timestamp - exportVideo.currentTime) < 0.6)
        .forEach((event) => {
          const pulse = 1 - Math.abs(event.timestamp - exportVideo.currentTime) / 0.6;
          if (!event.position) return;
          const ex = out.width * event.position.x;
          const ey = out.height * event.position.y;
          outCtx.save();
          outCtx.globalAlpha = pulse;
          outCtx.strokeStyle = profile.color;
          outCtx.lineWidth = 8;
          outCtx.beginPath();
          outCtx.arc(ex, ey, 34 + 70 * (1 - pulse), 0, Math.PI * 2);
          outCtx.stroke();
          outCtx.restore();
        });

      outCtx.fillStyle = "rgba(0,0,0,.48)";
      outCtx.fillRect(out.width - 236, 22, 204, 42);
      outCtx.fillStyle = "rgba(255,255,255,.86)";
      outCtx.font = "700 24px sans-serif";
      outCtx.fillText("剪球 AI Preview", out.width - 220, 51);
      requestAnimationFrame(draw);
    };
    draw();
  });
}

$("videoInput").addEventListener("change", (event) => selectFile(event.target.files[0]));
$("dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("dropZone").style.borderColor = "var(--accent)";
});
$("dropZone").addEventListener("dragleave", () => {
  $("dropZone").style.borderColor = "#52606b";
});
$("dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropZone").style.borderColor = "#52606b";
  selectFile(event.dataTransfer.files[0]);
});

video.addEventListener("loadedmetadata", () => {
  state.duration = video.duration || 0;
  renderAll();
  setLog(["已读取视频信息。", `原片时长 ${formatTime(state.duration)}，可以开始分析。`]);
});
video.addEventListener("timeupdate", () => {
  skipRemovedSegments();
  updatePlaybackProgress();
});
video.addEventListener("seeked", updatePlaybackProgress);
video.addEventListener("play", () => {
  cancelAnimationFrame(state.raf);
  drawEffects();
});
video.addEventListener("pause", () => {
  cancelAnimationFrame(state.raf);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

$("analyzeBtn").addEventListener("click", generateAnalysis);
$("demoBtn").addEventListener("click", createDemoVideo);
$("restoreBtn").addEventListener("click", () => {
  state.restored = !state.restored;
  $("restoreBtn").textContent = state.restored ? "重新删除" : "恢复全部";
  renderAll();
});
$("decisionBtn").addEventListener("click", () => {
  downloadText("jianqiu-edit-decision.json", JSON.stringify(makeDecisionPayload(), null, 2), "application/json");
});
$("exportBtn").addEventListener("click", exportPreview);
$("timeline").addEventListener("click", (event) => {
  if (!state.duration) return;
  const rect = $("timeline").getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  video.currentTime = ratio * state.duration;
  updatePlaybackProgress();
});
window.addEventListener("resize", sizeCanvasToVideo);

renderAll();
