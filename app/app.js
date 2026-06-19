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
  analyzing: false,
  analysisJobId: null,
  analysisRequest: null,
  analysisPollTimer: 0,
  ballColor: null,
  calibrationMode: false,
  currentCacheKey: null,
  persistTimer: 0,
  editHistory: [],
  editHistoryIndex: -1,
  pendingCutStart: null
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
const analysisDbName = "jianqiu-local-analysis";
const analysisStoreName = "results";
const projectStoreName = "projects";
const activeJobStorageKey = "jianqiu-active-analysis";

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

async function checkLocalAnalyzerEnvironment() {
  try {
    const response = await fetch("/api/system", { cache: "no-store" });
    const environment = await response.json();
    if (!environment.ready) {
      $("analyzeBtn").disabled = true;
      setLog([
        "本地 OpenCV 环境尚未就绪。",
        environment.error || "缺少 Python、OpenCV 或 NumPy。",
        environment.installCommand || "python -m pip install opencv-python numpy"
      ]);
      return;
    }
    document.querySelector(".privacy-pill").textContent =
      `本地处理 · Python ${environment.python} · OpenCV ${environment.opencv}`;
  } catch {
    setLog(["无法读取本地分析环境状态，请确认剪球服务仍在运行。"]);
  }
}

function formatRemaining(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "正在估算剩余时间";
  if (seconds < 10) return "预计不到 10 秒";
  if (seconds < 60) return `预计剩余 ${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.ceil(seconds % 60);
  return `预计剩余 ${minutes} 分 ${remainder} 秒`;
}

function formatBytesPerSecond(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

function showAnalysisProgress({ phase, percent, eta, speed }) {
  $("analysisProgress").hidden = false;
  $("analysisPhase").textContent = phase;
  $("analysisPercent").textContent = `${Math.round(clamp(percent, 0, 1) * 100)}%`;
  $("analysisProgressBar").style.width = `${clamp(percent, 0, 1) * 100}%`;
  $("analysisEta").textContent = eta;
  $("analysisSpeed").textContent = speed || "";
}

function hideAnalysisProgress() {
  $("analysisProgress").hidden = true;
  $("analysisProgressBar").style.width = "0%";
}

function openAnalysisDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(analysisDbName, 2);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(analysisStoreName)) {
        db.createObjectStore(analysisStoreName, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(projectStoreName)) {
        db.createObjectStore(projectStoreName, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function getAnalysisCacheKey(file, sport, strength, sensitivity, preset) {
  return [
    "v4",
    file.name,
    file.size,
    file.lastModified,
    sport,
    strength,
    sensitivity,
    preset,
    state.ballColor ? state.ballColor.join(",") : "default"
  ].join(":");
}

function updateBallColorUi() {
  const swatch = $("ballColorSwatch");
  if (!state.ballColor) {
    swatch.hidden = true;
    $("resetBallColorBtn").disabled = true;
    $("ballColorStatus").textContent = state.calibrationMode
      ? "请点击视频画面中清晰可见的球"
      : "使用运动默认球色";
    return;
  }
  const [red, green, blue] = state.ballColor;
  swatch.hidden = false;
  swatch.style.background = `rgb(${red}, ${green}, ${blue})`;
  $("resetBallColorBtn").disabled = false;
  $("ballColorStatus").textContent = `已校准 RGB(${red}, ${green}, ${blue})`;
}

function startBallColorCalibration() {
  if (!state.file) return;
  state.calibrationMode = true;
  video.pause();
  document.querySelector(".player-frame").classList.add("calibrating");
  updateBallColorUi();
}

function resetBallColor() {
  state.ballColor = null;
  state.calibrationMode = false;
  document.querySelector(".player-frame").classList.remove("calibrating");
  updateBallColorUi();
}

function sampleBallColor(event) {
  if (!state.calibrationMode || !video.videoWidth || !video.videoHeight) return;
  const rect = video.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) return;
  const sourceX = Math.floor(((event.clientX - rect.left) / rect.width) * video.videoWidth);
  const sourceY = Math.floor(((event.clientY - rect.top) / rect.height) * video.videoHeight);
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 5;
  sampleCanvas.height = 5;
  const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(video, sourceX - 2, sourceY - 2, 5, 5, 0, 0, 5, 5);
  const pixels = sampleContext.getImageData(0, 0, 5, 5).data;
  const channels = [[], [], []];
  for (let index = 0; index < pixels.length; index += 4) {
    channels[0].push(pixels[index]);
    channels[1].push(pixels[index + 1]);
    channels[2].push(pixels[index + 2]);
  }
  state.ballColor = channels.map((values) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  state.calibrationMode = false;
  document.querySelector(".player-frame").classList.remove("calibrating");
  updateBallColorUi();
  setLog([
    "球颜色已校准。",
    "下一次分析会使用该颜色生成视频专用检测范围；点击“重置”可恢复运动默认值。"
  ]);
}

async function readAnalysisCache(key) {
  const db = await openAnalysisDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(analysisStoreName, "readonly");
    const request = transaction.objectStore(analysisStoreName).get(key);
    request.addEventListener("success", () => resolve(request.result?.result || null));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => db.close());
  });
}

async function writeAnalysisCache(key, result) {
  const db = await openAnalysisDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(analysisStoreName, "readwrite");
    transaction.objectStore(analysisStoreName).put({
      key,
      result,
      savedAt: Date.now()
    });
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error);
    });
  });
}

async function readProjectEdits(key) {
  const db = await openAnalysisDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(projectStoreName, "readonly");
    const request = transaction.objectStore(projectStoreName).get(key);
    request.addEventListener("success", () => resolve(request.result?.edits || null));
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => db.close());
  });
}

async function writeProjectEdits(key, edits) {
  const db = await openAnalysisDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(projectStoreName, "readwrite");
    transaction.objectStore(projectStoreName).put({
      key,
      edits,
      savedAt: Date.now()
    });
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error);
    });
  });
}

function snapshotProjectEdits() {
  return {
    events: state.events.map((event) => ({
      ...event
    })),
    segments: state.segments.map((segment) => ({
      ...segment
    })),
    restored: state.restored
  };
}

function initializeEditHistory() {
  state.editHistory = [snapshotProjectEdits()];
  state.editHistoryIndex = 0;
  updateEditHistoryButtons();
}

function pushEditHistory() {
  const snapshot = snapshotProjectEdits();
  state.editHistory = state.editHistory.slice(0, state.editHistoryIndex + 1);
  state.editHistory.push(snapshot);
  if (state.editHistory.length > 30) state.editHistory.shift();
  state.editHistoryIndex = state.editHistory.length - 1;
  updateEditHistoryButtons();
}

function updateEditHistoryButtons() {
  $("undoEditBtn").disabled = state.editHistoryIndex <= 0;
  $("redoEditBtn").disabled =
    state.editHistoryIndex < 0 || state.editHistoryIndex >= state.editHistory.length - 1;
}

function restoreEditSnapshot(snapshot) {
  applyProjectEdits(snapshot);
  renderAll();
  scheduleProjectPersist();
  updateEditHistoryButtons();
}

function undoEdit() {
  if (state.editHistoryIndex <= 0) return;
  state.editHistoryIndex -= 1;
  restoreEditSnapshot(state.editHistory[state.editHistoryIndex]);
}

function redoEdit() {
  if (state.editHistoryIndex >= state.editHistory.length - 1) return;
  state.editHistoryIndex += 1;
  restoreEditSnapshot(state.editHistory[state.editHistoryIndex]);
}

function applyProjectEdits(edits) {
  if (!edits) return;
  const originalIds = new Set(state.events.map((event) => event.id));
  const savedById = new Map((edits.events || []).map((event) => [event.id, event]));
  state.events = state.events.map((event) => {
    const saved = savedById.get(event.id);
    return saved ? { ...event, ...saved } : event;
  });
  (edits.events || [])
    .filter((event) => !originalIds.has(event.id) && event.source === "manual")
    .forEach((event) => state.events.push(event));
  const savedSegments = edits.segments || [];
  if (savedSegments.length && savedSegments.every((segment) =>
    Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.type
  )) {
    state.segments = savedSegments.map((segment) => ({ ...segment }));
  } else {
    const segmentEdits = new Map(savedSegments.map((segment) => [segment.id, segment]));
    state.segments = state.segments.map((segment) => ({
      ...segment,
      restored: Boolean(segmentEdits.get(segment.id)?.restored)
    }));
  }
  state.restored = Boolean(edits.restored);
  $("restoreBtn").textContent = state.restored ? "重新删除" : "恢复全部";
  state.events.sort((a, b) => a.timestamp - b.timestamp);
  rebuildHighlights();
}

function scheduleProjectPersist() {
  if (!state.currentCacheKey || !state.analysisQuality) return;
  clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(() => {
    writeProjectEdits(state.currentCacheKey, snapshotProjectEdits()).catch(() => {});
  }, 250);
}

function applyAnalysisResult(result) {
  state.duration = result.duration || state.duration;
  state.events = (result.events || []).map((event) => ({
    ...event,
    reviewStatus: "unreviewed",
    source: "opencv",
    favorite: false,
    shotType: "unclassified",
    note: ""
  }));
  state.segments = (result.segments || []).map((segment) => ({
    ...segment,
    restored: false
  }));
  state.highlights = result.highlights || [];
  state.trajectory = result.trajectory || [];
  state.analysisQuality = result.quality || null;
  state.restored = false;
  rebuildHighlights();
  $("exportBtn").disabled = false;
  $("decisionBtn").disabled = false;
  $("restoreBtn").disabled = false;
  $("addHitBtn").disabled = false;
  $("confirmHighBtn").disabled = false;
  $("markCutStartBtn").disabled = false;
  $("previousEventBtn").disabled = false;
  $("nextEventBtn").disabled = false;
  renderAll();
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
  $("addHitBtn").disabled = true;
  $("confirmHighBtn").disabled = true;
  $("markCutStartBtn").disabled = true;
  $("finishCutBtn").disabled = true;
  state.pendingCutStart = null;
  $("previousEventBtn").disabled = true;
  $("nextEventBtn").disabled = true;
  $("calibrateBallBtn").disabled = false;
  state.events = [];
  state.segments = [];
  state.highlights = [];
  state.trajectory = [];
  state.analysisQuality = null;
  state.ballColor = null;
  state.calibrationMode = false;
  state.currentCacheKey = null;
  state.editHistory = [];
  state.editHistoryIndex = -1;
  updateEditHistoryButtons();
  $("restoreBtn").textContent = "恢复全部";
  document.querySelector(".player-frame").classList.remove("calibrating");
  updateBallColorUi();
  $("trainingReport").hidden = true;
  renderAll();
  setLog(["视频已载入，等待读取时长。", "本地模式不会把文件发送到网络。"]);
}

async function generateAnalysis() {
  if (!state.file || state.analyzing) return;
  const sport = $("sportSelect").value;
  const profile = sportProfiles[sport];
  const strength = Number($("cutStrength").value);
  const sensitivity = Number($("hitSensitivity").value);
  const preset = $("analysisPreset").value;
  const cacheKey = getAnalysisCacheKey(state.file, sport, strength, sensitivity, preset);
  state.currentCacheKey = cacheKey;
  state.analyzing = true;
  state.analysisJobId = null;
  $("analyzeBtn").disabled = true;
  $("analyzeBtn").textContent = "OpenCV 正在逐帧分析...";
  showAnalysisProgress({
    phase: "正在上传到本机分析器",
    percent: 0,
    eta: "正在估算剩余时间",
    speed: ""
  });
  setLog([
    `正在分析 ${profile.name} 视频真实帧。`,
    "检测运动区域、球色候选、连续轨迹以及方向/速度突变。",
    "长视频可能需要数分钟，请保持本地服务窗口开启。"
  ]);

  try {
    if ($("reuseCache").checked) {
      const cached = await readAnalysisCache(cacheKey).catch(() => null);
      if (cached) {
        applyAnalysisResult(cached);
        const edits = await readProjectEdits(cacheKey).catch(() => null);
        applyProjectEdits(edits);
        initializeEditHistory();
        renderAll();
        setLog([
          `已从本机缓存恢复 ${profile.name} 分析结果。`,
          `轨迹 ${state.trajectory.length} 点，疑似击球 ${state.events.length} 个。`,
          "原视频未被复制或上传；需要重新计算时关闭“复用本机分析缓存”。"
        ]);
        return;
      }
    }

    const job = await uploadAnalysisJob(
      state.file,
      sport,
      strength,
      sensitivity,
      preset,
      state.ballColor,
      cacheKey
    );
    state.analysisJobId = job.id;
    sessionStorage.setItem(activeJobStorageKey, JSON.stringify({
      id: job.id,
      cacheKey,
      fileName: state.file.name
    }));
    const result = await waitForAnalysisResult(job.id);
    applyAnalysisResult(result);
    initializeEditHistory();
    await writeAnalysisCache(cacheKey, result).catch(() => {});
    await writeProjectEdits(cacheKey, snapshotProjectEdits()).catch(() => {});

    const coverage = Math.round((result.quality?.coverage || 0) * 100);
    const messages = [
      `完成 ${result.sportName || profile.name} OpenCV 本地分析。`,
      `追踪到 ${state.trajectory.length} 个真实球位置，轨迹覆盖约 ${coverage}%。`,
      `检测到 ${state.events.length} 个疑似击球，生成 ${state.highlights.length} 个候选精彩片段。`
    ];
    if (result.quality?.warning) messages.push(result.quality.warning);
    setLog(messages);
  } catch (error) {
    state.events = [];
    state.segments = [{ id: "keep_0", start: 0, end: state.duration, type: "keep" }];
    state.highlights = [];
    state.trajectory = [];
    const cancelled = error.name === "AbortError" || error.message === "用户已取消分析";
    setLog(cancelled ? ["分析已取消，临时视频正在清理。"] : ["分析失败，没有生成模拟结果。", error.message]);
    renderAll();
  } finally {
    clearTimeout(state.analysisPollTimer);
    state.analysisPollTimer = 0;
    state.analysisRequest = null;
    state.analysisJobId = null;
    sessionStorage.removeItem(activeJobStorageKey);
    state.analyzing = false;
    $("analyzeBtn").disabled = false;
    $("analyzeBtn").textContent = "开始本地分析";
    hideAnalysisProgress();
  }
}

function uploadAnalysisJob(file, sport, strength, sensitivity, preset, ballColor, cacheKey) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    state.analysisRequest = xhr;
    const startedAt = performance.now();
    let lastLoaded = 0;
    let lastAt = startedAt;
    let smoothedSpeed = 0;

    const ballQuery = ballColor ? `&ball=${encodeURIComponent(ballColor.join(","))}` : "";
    xhr.open(
      "POST",
      `/api/analyze/start?sport=${encodeURIComponent(sport)}&strength=${strength}&sensitivity=${sensitivity}&preset=${encodeURIComponent(preset)}${ballQuery}`
    );
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Jianqiu-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Jianqiu-Cache-Key", encodeURIComponent(cacheKey));
    xhr.upload.addEventListener("progress", (event) => {
      const now = performance.now();
      const elapsed = Math.max(0.001, (now - lastAt) / 1000);
      const currentSpeed = (event.loaded - lastLoaded) / elapsed;
      smoothedSpeed = smoothedSpeed ? smoothedSpeed * 0.72 + currentSpeed * 0.28 : currentSpeed;
      const total = event.lengthComputable ? event.total : file.size;
      const uploadProgress = total ? event.loaded / total : 0;
      const eta = smoothedSpeed > 0 ? (total - event.loaded) / smoothedSpeed : null;
      showAnalysisProgress({
        phase: "正在传入本机分析器",
        percent: uploadProgress * 0.12,
        eta: formatRemaining(eta),
        speed: formatBytesPerSecond(smoothedSpeed)
      });
      lastLoaded = event.loaded;
      lastAt = now;
    });
    xhr.addEventListener("load", () => {
      try {
        const payload = JSON.parse(xhr.responseText);
        if (xhr.status !== 202) throw new Error(payload.error || "无法创建分析任务");
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });
    xhr.addEventListener("error", () => reject(new Error("无法连接本地分析服务")));
    xhr.addEventListener("abort", () => reject(new DOMException("用户已取消分析", "AbortError")));
    xhr.send(file);
  });
}

async function resumeActiveAnalysis() {
  const saved = sessionStorage.getItem(activeJobStorageKey);
  if (!saved) return;
  let active;
  try {
    active = JSON.parse(saved);
  } catch {
    sessionStorage.removeItem(activeJobStorageKey);
    return;
  }
  if (!active?.id || !active?.cacheKey) {
    sessionStorage.removeItem(activeJobStorageKey);
    return;
  }

  state.analyzing = true;
  state.analysisJobId = active.id;
  $("analyzeBtn").disabled = true;
  $("analysisProgress").hidden = false;
  setLog([
    `正在重新连接 ${active.fileName || "上一个视频"} 的后台分析任务。`,
    "任务仍在本机运行，完成后会写入分析缓存。"
  ]);
  try {
    const result = await waitForAnalysisResult(active.id);
    await writeAnalysisCache(active.cacheKey, result);
    setLog([
      `${active.fileName || "视频"} 的后台分析已经完成。`,
      "请重新选择同一视频并点击分析，系统会立即从本机缓存恢复结果。"
    ]);
  } catch (error) {
    setLog(["后台分析任务未能恢复。", error.message]);
  } finally {
    clearTimeout(state.analysisPollTimer);
    state.analysisPollTimer = 0;
    state.analysisJobId = null;
    state.analyzing = false;
    sessionStorage.removeItem(activeJobStorageKey);
    hideAnalysisProgress();
    $("analyzeBtn").disabled = !state.file;
  }
}

async function waitForAnalysisResult(jobId) {
  while (state.analyzing && state.analysisJobId === jobId) {
    const response = await fetch(`/api/analyze/status?id=${encodeURIComponent(jobId)}`, {
      cache: "no-store"
    });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "无法读取分析进度");

    const analysisProgress = clamp(Number(job.progress) || 0, 0, 1);
    const overallProgress = 0.12 + analysisProgress * 0.88;
    const processed = formatTime(job.processedSeconds || 0);
    const total = job.totalSeconds ? formatTime(job.totalSeconds) : "--:--";
    const phase = job.phase === "finalizing"
      ? "正在生成轨迹与剪辑建议"
      : `OpenCV 逐帧分析 ${processed} / ${total}`;
    showAnalysisProgress({
      phase,
      percent: overallProgress,
      eta: formatRemaining(job.etaSeconds),
      speed: job.processingFps ? `${job.processingFps.toFixed(1)} 帧/s` : ""
    });

    if (job.status === "completed") {
      const resultResponse = await fetch(`/api/analyze/result?id=${encodeURIComponent(jobId)}`, {
        cache: "no-store"
      });
      const result = await resultResponse.json();
      if (!resultResponse.ok) throw new Error(result.error || "无法读取分析结果");
      return result;
    }
    if (job.status === "failed" || job.status === "cancelled") {
      throw new Error(job.error || (job.status === "cancelled" ? "用户已取消分析" : "本地分析失败"));
    }
    await new Promise((resolve) => {
      state.analysisPollTimer = setTimeout(resolve, 700);
    });
  }
  throw new DOMException("用户已取消分析", "AbortError");
}

async function cancelAnalysis() {
  if (!state.analyzing) return;
  state.analyzing = false;
  if (state.analysisRequest && state.analysisRequest.readyState !== XMLHttpRequest.DONE) {
    state.analysisRequest.abort();
    return;
  }
  if (state.analysisJobId) {
    try {
      await fetch(`/api/analyze/cancel?id=${encodeURIComponent(state.analysisJobId)}`, {
        method: "DELETE"
      });
    } catch {
      // The local process may already have exited.
    }
  }
}

function getRemovedDuration() {
  if (state.restored) return 0;
  return state.segments
    .filter((segment) => segment.type === "remove" && !segment.restored)
    .reduce((sum, segment) => sum + segment.end - segment.start, 0);
}

function getKeptSegments() {
  if (state.restored) return [{ start: 0, end: state.duration, type: "keep" }];
  return state.segments
    .filter((segment) => (segment.type === "keep" || segment.restored) && segment.end > segment.start);
}

function getActiveEvents() {
  return state.events.filter((event) => event.reviewStatus !== "ignored");
}

function rebuildHighlights() {
  const activeEvents = getActiveEvents().slice().sort((a, b) => a.timestamp - b.timestamp);
  state.highlights = activeEvents
    .filter((event) => event.reviewStatus === "confirmed" || event.source === "manual" || event.confidence >= 0.58)
    .map((event, index) => ({
      id: `highlight_reviewed_${index + 1}`,
      start: clamp(event.timestamp - 2.2, 0, state.duration),
      end: clamp(event.timestamp + 3, 0, state.duration),
      score: getHighlightScore(event, activeEvents),
      reason: getHighlightReason(event, activeEvents),
      eventId: event.id,
      favorite: Boolean(event.favorite)
    }))
    .sort((a, b) => b.score - a.score)
    .map((highlight, rank) => ({ ...highlight, rank: rank + 1 }));
}

function getHighlightScore(event, events) {
  if (event.favorite) return 1;
  const evidence = event.evidence || {};
  const speedScore = clamp((evidence.speedAfterPxPerSec || 0) / 650, 0, 1);
  const directionScore = clamp((evidence.directionChangeDegrees || 0) / 180, 0, 1);
  const continuityScore = evidence.trackContinuity || 0;
  const nearbyHits = events.filter((candidate) =>
    candidate.id !== event.id && Math.abs(candidate.timestamp - event.timestamp) <= 8
  ).length;
  const sequenceScore = clamp(nearbyHits / 3, 0, 1);
  const reviewedBonus = event.reviewStatus === "confirmed" || event.source === "manual" ? 0.12 : 0;
  return clamp(
    event.confidence * 0.38 +
    speedScore * 0.22 +
    directionScore * 0.16 +
    continuityScore * 0.12 +
    sequenceScore * 0.12 +
    reviewedBonus,
    0,
    1
  );
}

function getHighlightReason(event, events) {
  if (event.favorite) return "用户收藏";
  if (event.source === "manual") return "用户手动添加";
  const evidence = event.evidence || {};
  const nearbyHits = events.filter((candidate) =>
    candidate.id !== event.id && Math.abs(candidate.timestamp - event.timestamp) <= 8
  ).length;
  if ((evidence.speedAfterPxPerSec || 0) >= 500) return "高画面球速";
  if (nearbyHits >= 2) return "连续击球片段";
  if (event.reviewStatus === "confirmed") return "用户确认击球";
  return "球轨迹明显变化";
}

function buildTrainingSummary() {
  const events = getActiveEvents().slice().sort((a, b) => a.timestamp - b.timestamp);
  const intervals = events.slice(1).map((event, index) => event.timestamp - events[index].timestamp);
  const averageInterval = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : null;
  let longestSequence = events.length ? 1 : 0;
  let currentSequence = events.length ? 1 : 0;
  intervals.forEach((interval) => {
    if (interval <= 8) {
      currentSequence += 1;
      longestSequence = Math.max(longestSequence, currentSequence);
    } else {
      currentSequence = 1;
    }
  });
  const fastestSpeed = events.reduce(
    (maximum, event) => Math.max(maximum, event.evidence?.speedAfterPxPerSec || 0),
    0
  );
  const reviewed = state.events.filter((event) =>
    event.reviewStatus === "confirmed" || event.reviewStatus === "ignored" || event.source === "manual"
  ).length;
  const reviewRate = state.events.length ? reviewed / state.events.length : 0;
  const keptRatio = state.duration ? (state.duration - getRemovedDuration()) / state.duration : 0;
  const coverage = state.analysisQuality?.coverage || 0;
  const averageConfidence = events.length
    ? events.reduce((sum, event) => sum + event.confidence, 0) / events.length
    : 0;
  const trustScore = clamp(coverage * 0.45 + averageConfidence * 0.4 + Math.min(1, events.length / 6) * 0.15, 0, 1);
  const trustLabel = trustScore >= 0.72 ? "较高" : trustScore >= 0.45 ? "中等" : "需复核";
  const shotTypes = events.reduce((counts, event) => {
    const key = event.shotType || "unclassified";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  return {
    sport: $("sportSelect").value,
    duration: state.duration,
    activeEvents: events.length,
    averageInterval,
    longestSequence,
    fastestSpeed,
    keptRatio,
    reviewRate,
    trustScore,
    trustLabel,
    trajectoryCoverage: coverage,
    cameraStability: state.analysisQuality?.cameraStability || 0,
    medianSharpness: state.analysisQuality?.medianSharpness || 0,
    medianBrightness: state.analysisQuality?.medianBrightness || 0,
    recommendations: state.analysisQuality?.recommendations || [],
    shotTypes,
    removedDuration: getRemovedDuration(),
    generatedAt: new Date().toISOString()
  };
}

function renderTrainingReport() {
  const report = $("trainingReport");
  if (!state.analysisQuality) {
    report.hidden = true;
    return;
  }
  const summary = buildTrainingSummary();
  report.hidden = false;
  $("trainingReportTitle").textContent = `${sportProfiles[$("sportSelect").value].name}训练摘要`;
  const values = [
    ["有效运动", `${Math.round(summary.keptRatio * 100)}%`],
    ["有效击球", String(summary.activeEvents)],
    ["平均间隔", summary.averageInterval == null ? "--" : `${summary.averageInterval.toFixed(1)} 秒`],
    ["最长连续", `${summary.longestSequence} 次`],
    ["最快画面球速", summary.fastestSpeed ? `${Math.round(summary.fastestSpeed)} px/s` : "--"],
    ["识别可信度", summary.trustLabel],
    ["机位稳定", `${Math.round(summary.cameraStability * 100)}%`]
  ];
  $("trainingReportMetrics").innerHTML = values
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
  const recommendations = summary.recommendations.length
    ? ` 拍摄建议：${summary.recommendations.join("；")}。`
    : "";
  $("trainingReportNote").textContent =
    `轨迹覆盖 ${Math.round(summary.trajectoryCoverage * 100)}%，已审阅 ${Math.round(summary.reviewRate * 100)}%。` +
    (summary.trustLabel === "需复核"
      ? " 建议逐项确认候选击球后再导出精彩集锦。"
      : " 可继续确认或忽略候选，报告会实时更新。") +
    recommendations;
  const classified = Object.entries(summary.shotTypes)
    .filter(([type, count]) => type !== "unclassified" && count > 0)
    .map(([type, count]) => `${getShotTypeLabel(type)} ${count}`)
    .join("，");
  if (classified) $("trainingReportNote").textContent += ` 动作分布：${classified}。`;
  renderShotMap();
}

function renderShotMap() {
  const shotMap = $("shotMap");
  const shotContext = shotMap.getContext("2d");
  shotContext.clearRect(0, 0, shotMap.width, shotMap.height);
  shotContext.fillStyle = "#101418";
  shotContext.fillRect(0, 0, shotMap.width, shotMap.height);
  shotContext.strokeStyle = "rgba(255,255,255,0.16)";
  shotContext.lineWidth = 2;
  shotContext.strokeRect(32, 24, shotMap.width - 64, shotMap.height - 48);
  shotContext.beginPath();
  shotContext.moveTo(shotMap.width / 2, 24);
  shotContext.lineTo(shotMap.width / 2, shotMap.height - 24);
  shotContext.moveTo(32, shotMap.height / 2);
  shotContext.lineTo(shotMap.width - 32, shotMap.height / 2);
  shotContext.stroke();

  const activeEvents = getActiveEvents().filter((event) => event.position);
  activeEvents.forEach((event, index) => {
    const score = getHighlightScore(event, activeEvents);
    const x = 32 + event.position.x * (shotMap.width - 64);
    const y = 24 + event.position.y * (shotMap.height - 48);
    const radius = 5 + score * 7;
    shotContext.save();
    shotContext.globalAlpha = event.reviewStatus === "confirmed" || event.favorite ? 1 : 0.72;
    shotContext.fillStyle = event.favorite ? "#f6c85f" : "#4cc9a4";
    shotContext.beginPath();
    shotContext.arc(x, y, radius, 0, Math.PI * 2);
    shotContext.fill();
    shotContext.fillStyle = "#06100d";
    shotContext.font = "700 10px sans-serif";
    shotContext.textAlign = "center";
    shotContext.textBaseline = "middle";
    shotContext.fillText(String(index + 1), x, y);
    shotContext.restore();
  });
}

function locateShotMapEvent(event) {
  const rect = $("shotMap").getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  const activeEvents = getActiveEvents().filter((candidate) => candidate.position);
  const nearest = activeEvents.reduce((best, candidate) => {
    const distance = Math.hypot(candidate.position.x - x, candidate.position.y - y);
    return !best || distance < best.distance ? { event: candidate, distance } : best;
  }, null);
  if (!nearest || nearest.distance > 0.12) return;
  video.currentTime = nearest.event.timestamp;
  updatePlaybackProgress();
  video.play();
}

function renderTimeline() {
  const timeline = $("timeline");
  timeline.innerHTML = "";
  if (!state.duration) return;

  const fragment = document.createDocumentFragment();
  state.segments.forEach((segment) => {
    const div = document.createElement("button");
    div.type = "button";
    div.className = `segment ${(state.restored || segment.restored) && segment.type === "remove" ? "keep" : segment.type}`;
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

  getActiveEvents().forEach((event) => {
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
    renderCuts();
    return;
  }

  const filter = $("eventFilter").value;
  const visibleEvents = state.events.filter((event) => {
    if (filter === "all") return true;
    if (filter === "favorite") return event.favorite;
    return event.reviewStatus === filter;
  });
  if (!visibleEvents.length) {
    list.innerHTML = '<div class="event-card"><span>当前筛选下没有候选。</span></div>';
  }
  visibleEvents.slice(0, 80).forEach((event) => {
    const card = document.createElement("div");
    card.className = `event-card ${event.reviewStatus || ""}`;
    const statusText = event.reviewStatus === "confirmed"
      ? "已确认"
      : event.reviewStatus === "ignored"
        ? "已忽略"
        : event.source === "manual"
          ? "手动添加"
          : "待确认";
    card.innerHTML = `
      <div>
        <strong>${event.label}</strong>
        <span>${formatTime(event.timestamp)} · 置信度 ${Math.round(event.confidence * 100)}%</span>
        <span>${formatEvidence(event.evidence)}</span>
        <span>精彩分 ${Math.round(getHighlightScore(event, getActiveEvents()) * 100)}</span>
        <span class="event-status">${statusText}</span>
        <div class="event-annotation">
          <select data-field="shotType" aria-label="动作类型">
            <option value="unclassified">未分类</option>
            <option value="serve">发球</option>
            <option value="forehand">正手</option>
            <option value="backhand">反手</option>
            <option value="volley">截击</option>
            <option value="overhead">高压</option>
            <option value="error">失误</option>
          </select>
          <input data-field="note" type="text" maxlength="80" placeholder="教练备注" value="${escapeAttribute(event.note || "")}" />
        </div>
      </div>
      <div class="event-actions">
        <button type="button" data-action="locate">定位</button>
        <button type="button" data-action="confirm">${event.reviewStatus === "confirmed" ? "取消确认" : "确认"}</button>
        <button type="button" data-action="ignore">${event.reviewStatus === "ignored" ? "恢复" : "忽略"}</button>
        <button type="button" data-action="favorite">${event.favorite ? "取消收藏" : "收藏"}</button>
      </div>
    `;
    card.querySelector('[data-field="shotType"]').value = event.shotType || "unclassified";
    card.querySelector('[data-field="shotType"]').addEventListener("change", (changeEvent) => {
      event.shotType = changeEvent.target.value;
      pushEditHistory();
      scheduleProjectPersist();
      renderTrainingReport();
    });
    card.querySelector('[data-field="note"]').addEventListener("change", (changeEvent) => {
      event.note = changeEvent.target.value.trim();
      pushEditHistory();
      scheduleProjectPersist();
    });
    card.querySelector(".event-actions").addEventListener("click", (clickEvent) => {
      const action = clickEvent.target.dataset.action;
      if (!action) return;
      if (action === "locate") {
        video.currentTime = event.timestamp;
        video.play();
        return;
      }
      if (action === "confirm") {
        event.reviewStatus = event.reviewStatus === "confirmed" ? "unreviewed" : "confirmed";
      }
      if (action === "ignore") {
        event.reviewStatus = event.reviewStatus === "ignored" ? "unreviewed" : "ignored";
      }
      if (action === "favorite") {
        event.favorite = !event.favorite;
        if (event.favorite && event.reviewStatus === "ignored") event.reviewStatus = "unreviewed";
      }
      rebuildHighlights();
      pushEditHistory();
      scheduleProjectPersist();
      renderAll();
    });
    list.appendChild(card);
  });
  renderCuts();
}

function confirmHighConfidenceEvents() {
  state.events.forEach((event) => {
    if (event.reviewStatus !== "ignored" && (event.confidence >= 0.88 || event.favorite)) {
      event.reviewStatus = "confirmed";
    }
  });
  rebuildHighlights();
  pushEditHistory();
  scheduleProjectPersist();
  renderAll();
}

function renderCuts() {
  const list = $("cutList");
  list.innerHTML = "";
  const cuts = state.segments.filter((segment) => segment.type === "remove");
  if (!cuts.length) return;

  const heading = document.createElement("div");
  heading.className = "result-section-title";
  heading.textContent = `等待/冗余建议 ${cuts.length} 段`;
  list.appendChild(heading);

  cuts.forEach((segment) => {
    const card = document.createElement("div");
    card.className = `cut-card ${segment.restored ? "restored" : ""}`;
    card.innerHTML = `
      <div>
        <strong>${segment.restored ? "已恢复" : "建议删除"}</strong>
        <span>${formatTime(segment.start)}–${formatTime(segment.end)} · ${segment.reason}</span>
      </div>
      <button type="button">${segment.restored ? "重新删除" : "恢复"}</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      segment.restored = !segment.restored;
      pushEditHistory();
      scheduleProjectPersist();
      renderAll();
    });
    list.appendChild(card);
  });
}

function mergeRangesForCuts(ranges) {
  if (!ranges.length) return [];
  const sorted = ranges
    .map(([start, end]) => [Math.min(start, end), Math.max(start, end)])
    .filter(([start, end]) => end - start >= 0.1)
    .sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0]];
  sorted.slice(1).forEach(([start, end]) => {
    const previous = merged[merged.length - 1];
    if (start <= previous[1] + 0.05) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  });
  return merged;
}

function rebuildSegmentsFromCuts(cutRanges) {
  const cuts = mergeRangesForCuts(cutRanges);
  const segments = [];
  let cursor = 0;
  cuts.forEach(([start, end], index) => {
    const safeStart = clamp(start, 0, state.duration);
    const safeEnd = clamp(end, 0, state.duration);
    if (safeStart > cursor) {
      segments.push({
        id: `manual_keep_${index}_${Math.round(cursor * 1000)}`,
        start: cursor,
        end: safeStart,
        type: "keep",
        restored: false
      });
    }
    segments.push({
      id: `manual_remove_${index}_${Math.round(safeStart * 1000)}`,
      start: safeStart,
      end: safeEnd,
      type: "remove",
      reason: "用户手动删除",
      restored: false
    });
    cursor = safeEnd;
  });
  if (cursor < state.duration) {
    segments.push({
      id: `manual_keep_tail_${Math.round(cursor * 1000)}`,
      start: cursor,
      end: state.duration,
      type: "keep",
      restored: false
    });
  }
  state.segments = segments;
}

function markCutStart() {
  if (!state.analysisQuality) return;
  state.pendingCutStart = video.currentTime;
  $("finishCutBtn").disabled = false;
  $("markCutStartBtn").textContent = `起点 ${formatTime(state.pendingCutStart)}`;
  setLog(["已标记删除起点。", "移动到删除区间终点后点击“删除到此处”。"]);
}

function finishManualCut() {
  if (state.pendingCutStart == null) return;
  const end = video.currentTime;
  const existingCuts = state.segments
    .filter((segment) => segment.type === "remove" && !segment.restored)
    .map((segment) => [segment.start, segment.end]);
  existingCuts.push([state.pendingCutStart, end]);
  rebuildSegmentsFromCuts(existingCuts);
  state.pendingCutStart = null;
  $("finishCutBtn").disabled = true;
  $("markCutStartBtn").textContent = "标记删除起点";
  pushEditHistory();
  scheduleProjectPersist();
  renderAll();
}

function addHitAtCurrentTime() {
  if (!state.duration || !state.analysisQuality) return;
  const timestamp = video.currentTime;
  const nearestPoint = state.trajectory.reduce((best, point) => {
    if (!best || Math.abs(point.time - timestamp) < Math.abs(best.time - timestamp)) return point;
    return best;
  }, null);
  const hasNearbyPoint = nearestPoint && Math.abs(nearestPoint.time - timestamp) <= 0.8;
  state.events.push({
    id: `manual_${Date.now()}`,
    type: "hit",
    label: "手动击球",
    timestamp: Number(timestamp.toFixed(3)),
    confidence: 1,
    score: 1,
    position: hasNearbyPoint
      ? { x: nearestPoint.xNorm, y: nearestPoint.yNorm }
      : { x: 0.5, y: 0.5 },
    evidence: null,
    reviewStatus: "confirmed",
    source: "manual",
    favorite: true,
    shotType: "unclassified",
    note: ""
  });
  state.events.sort((a, b) => a.timestamp - b.timestamp);
  rebuildHighlights();
  pushEditHistory();
  scheduleProjectPersist();
  renderAll();
}

function navigateEvent(direction) {
  const events = getActiveEvents().slice().sort((a, b) => a.timestamp - b.timestamp);
  if (!events.length) return;
  const current = video.currentTime;
  const target = direction > 0
    ? events.find((event) => event.timestamp > current + 0.08) || events[0]
    : events.slice().reverse().find((event) => event.timestamp < current - 0.08) || events[events.length - 1];
  video.currentTime = target.timestamp;
  updatePlaybackProgress();
}

function reviewNearestEvent(action) {
  const event = getActiveEvents().reduce((nearest, candidate) => {
    if (!nearest || Math.abs(candidate.timestamp - video.currentTime) < Math.abs(nearest.timestamp - video.currentTime)) {
      return candidate;
    }
    return nearest;
  }, null);
  if (!event || Math.abs(event.timestamp - video.currentTime) > 2) return;
  if (action === "confirm") {
    event.reviewStatus = event.reviewStatus === "confirmed" ? "unreviewed" : "confirmed";
  }
  if (action === "ignore") {
    event.reviewStatus = "ignored";
  }
  rebuildHighlights();
  pushEditHistory();
  scheduleProjectPersist();
  renderAll();
}

function handleEditorShortcut(event) {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target.isContentEditable
  ) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (video.paused) video.play();
    else video.pause();
  } else if (event.key === "ArrowLeft") {
    video.currentTime = clamp(video.currentTime - 1, 0, state.duration);
  } else if (event.key === "ArrowRight") {
    video.currentTime = clamp(video.currentTime + 1, 0, state.duration);
  } else if (event.key.toLowerCase() === "p") {
    navigateEvent(-1);
  } else if (event.key.toLowerCase() === "n") {
    navigateEvent(1);
  } else if (event.key.toLowerCase() === "m") {
    addHitAtCurrentTime();
  } else if (event.key.toLowerCase() === "c") {
    reviewNearestEvent("confirm");
  } else if (event.key.toLowerCase() === "i") {
    reviewNearestEvent("ignore");
  }
}

function formatEvidence(evidence) {
  if (!evidence) return "无可用证据";
  return `方向变化 ${evidence.directionChangeDegrees}° · 速度 ${evidence.speedBeforePxPerSec}→${evidence.speedAfterPxPerSec}px/s · 连续度 ${Math.round(evidence.trackContinuity * 100)}%`;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getShotTypeLabel(value) {
  return {
    serve: "发球",
    forehand: "正手",
    backhand: "反手",
    volley: "截击",
    overhead: "高压",
    error: "失误",
    unclassified: "未分类"
  }[value] || "未分类";
}

function renderMetrics() {
  const kept = state.duration - getRemovedDuration();
  $("durationLabel").textContent = `${formatTime(video.currentTime)} / ${formatTime(state.duration)}`;
  $("metricOriginal").textContent = state.duration ? formatTime(state.duration) : "--";
  $("metricKept").textContent = state.duration ? formatTime(kept) : "--";
  const activeEvents = getActiveEvents();
  $("metricEvents").textContent = state.events.length ? String(activeEvents.length) : "--";
  $("metricHighlights").textContent = state.highlights.length ? String(state.highlights.length) : "--";
}

function renderAll() {
  renderTimeline();
  renderEvents();
  renderMetrics();
  renderTrainingReport();
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

function getEffectSettings(profile) {
  const style = $("effectStyle").value;
  if (style === "energy") {
    return { color: "#f6c85f", lineWidth: 7, trailWidth: 6, glow: 18, radius: 36, trailPoints: 22 };
  }
  if (style === "minimal") {
    return { color: profile.color, lineWidth: 2, trailWidth: 2, glow: 0, radius: 16, trailPoints: 10 };
  }
  return { color: profile.color, lineWidth: 5, trailWidth: 4, glow: 5, radius: 26, trailPoints: 18 };
}

function drawEffects() {
  sizeCanvasToVideo();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.events.length || video.paused || video.ended) {
    state.raf = requestAnimationFrame(drawEffects);
    return;
  }

  const profile = sportProfiles[$("sportSelect").value];
  const settings = getEffectSettings(profile);
  const now = video.currentTime;
  const recent = state.events.filter((event) => Math.abs(event.timestamp - now) < 0.65 && event.position);
  if ($("showImpact").checked) recent.forEach((event) => {
    const age = Math.abs(event.timestamp - now);
    const pulse = 1 - age / 0.65;
    const x = canvas.width * event.position.x;
    const y = canvas.height * event.position.y;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = settings.lineWidth;
    ctx.shadowColor = settings.color;
    ctx.shadowBlur = settings.glow;
    ctx.beginPath();
    ctx.arc(x, y, settings.radius + 58 * (1 - pulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = settings.color;
    ctx.beginPath();
    ctx.arc(x, y, 7 + 10 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  const trail = state.trajectory
    .filter((point) => point.time <= now && now - point.time < 1.2)
    .slice(-settings.trailPoints);
  if ($("showTrajectory").checked && trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = settings.color;
    ctx.lineWidth = settings.trailWidth;
    ctx.shadowColor = settings.color;
    ctx.shadowBlur = settings.glow;
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
  if ($("showTrajectory").checked && $("effectStyle").value !== "minimal") trail.forEach((point, index) => {
    const x = canvas.width * point.xNorm;
    const y = canvas.height * point.yNorm;
    ctx.save();
    ctx.globalAlpha = (index + 1) / Math.max(2, trail.length + 2);
    ctx.fillStyle = settings.color;
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

function updatePreviewPlaybackRate() {
  if (!$("autoSlowMotion").checked || !state.highlights.length) {
    if (video.playbackRate !== 1) video.playbackRate = 1;
    return;
  }
  const nearImpact = getActiveEvents().some((event) =>
    Math.abs(event.timestamp - video.currentTime) <= 0.5 &&
    state.highlights.some((highlight) => highlight.eventId === event.id)
  );
  const targetRate = nearImpact ? 0.5 : 1;
  if (video.playbackRate !== targetRate) video.playbackRate = targetRate;
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
    analysis_quality: state.analysisQuality,
    training_summary: state.analysisQuality ? buildTrainingSummary() : null
  };
}

function downloadTrainingReport() {
  if (!state.analysisQuality) return;
  const summary = buildTrainingSummary();
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const eventRows = state.events.map((event) => `
    <tr>
      <td>${formatTime(event.timestamp)}</td>
      <td>${escapeHtml(getShotTypeLabel(event.shotType))}</td>
      <td>${Math.round(event.confidence * 100)}%</td>
      <td>${Math.round(getHighlightScore(event, getActiveEvents()) * 100)}</td>
      <td>${escapeHtml(event.reviewStatus === "confirmed" ? "已确认" : event.reviewStatus === "ignored" ? "已忽略" : event.source === "manual" ? "手动添加" : "待确认")}</td>
      <td>${escapeHtml(event.note || formatEvidence(event.evidence))}</td>
    </tr>
  `).join("");
  const cutRows = state.segments
    .filter((segment) => segment.type === "remove")
    .map((segment) => `
      <tr>
        <td>${formatTime(segment.start)}–${formatTime(segment.end)}</td>
        <td>${escapeHtml(segment.reason)}</td>
        <td>${segment.restored ? "已恢复" : "建议删除"}</td>
      </tr>
    `).join("");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>剪球训练报告</title>
  <style>
    body{max-width:1080px;margin:40px auto;padding:0 24px;color:#182027;font:15px/1.6 Arial,"Microsoft YaHei",sans-serif}
    h1,h2{margin:0 0 12px}h1{font-size:30px}h2{margin-top:30px;font-size:20px}
    .muted{color:#66727d}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}
    .metric{border:1px solid #d8dee3;border-radius:6px;padding:14px}.metric span{display:block;color:#66727d;font-size:12px}.metric strong{font-size:21px}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border-bottom:1px solid #d8dee3;padding:9px 7px;text-align:left;vertical-align:top}
    th{background:#f4f7f8;font-size:12px}@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}table{font-size:12px}}
  </style>
</head>
<body>
  <p class="muted">剪球 · 本地生成</p>
  <h1>${escapeHtml(sportProfiles[$("sportSelect").value].name)}训练报告</h1>
  <p class="muted">${escapeHtml(state.file?.name || "")} · ${new Date().toLocaleString("zh-CN")}</p>
  <div class="metrics">
    <div class="metric"><span>视频时长</span><strong>${formatTime(summary.duration)}</strong></div>
    <div class="metric"><span>有效运动</span><strong>${Math.round(summary.keptRatio * 100)}%</strong></div>
    <div class="metric"><span>有效击球</span><strong>${summary.activeEvents}</strong></div>
    <div class="metric"><span>识别可信度</span><strong>${summary.trustLabel}</strong></div>
    <div class="metric"><span>平均间隔</span><strong>${summary.averageInterval == null ? "--" : `${summary.averageInterval.toFixed(1)} 秒`}</strong></div>
    <div class="metric"><span>最长连续</span><strong>${summary.longestSequence} 次</strong></div>
    <div class="metric"><span>轨迹覆盖</span><strong>${Math.round(summary.trajectoryCoverage * 100)}%</strong></div>
    <div class="metric"><span>机位稳定</span><strong>${Math.round(summary.cameraStability * 100)}%</strong></div>
  </div>
  <h2>拍摄质量</h2>
  <p>清晰度 ${Math.round(summary.medianSharpness)}，亮度 ${Math.round(summary.medianBrightness)}。${escapeHtml(summary.recommendations.join("；"))}</p>
  <h2>击球与关键动作</h2>
  <table><thead><tr><th>时间</th><th>类型</th><th>置信度</th><th>精彩分</th><th>审阅</th><th>证据</th></tr></thead><tbody>${eventRows || '<tr><td colspan="6">暂无事件</td></tr>'}</tbody></table>
  <h2>等待与冗余建议</h2>
  <table><thead><tr><th>时间</th><th>原因</th><th>状态</th></tr></thead><tbody>${cutRows || '<tr><td colspan="3">暂无删除建议</td></tr>'}</tbody></table>
  <p class="muted">本报告由本地 OpenCV 轨迹分析生成，疑似击球不等同于裁判级判定。</p>
</body>
</html>`;
  downloadText(
    `jianqiu-training-report-${Date.now()}.html`,
    html,
    "text/html;charset=utf-8"
  );
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

async function importProjectFile(file) {
  if (!state.file) {
    setLog(["请先选择项目对应的原视频，再导入剪辑项目。"]);
    return;
  }
  if (!file || file.size > 20 * 1024 * 1024) {
    setLog(["项目文件无效或超过 20MB 限制。"]);
    return;
  }
  try {
    const payload = JSON.parse(await file.text());
    if (
      !Array.isArray(payload.events) ||
      !Array.isArray(payload.segments) ||
      !Array.isArray(payload.trajectory)
    ) {
      throw new Error("缺少事件、片段或轨迹数据");
    }
    if (payload.duration && Math.abs(payload.duration - state.duration) > 2) {
      throw new Error("项目时长与当前视频不匹配");
    }
    state.events = payload.events.map((event) => ({
      ...event,
      reviewStatus: event.reviewStatus || "unreviewed",
      source: event.source || "opencv",
      favorite: Boolean(event.favorite)
    }));
    state.segments = payload.segments.map((segment) => ({
      ...segment,
      restored: Boolean(segment.restored)
    }));
    state.trajectory = payload.trajectory;
    state.analysisQuality = payload.analysis_quality || {
      coverage: state.duration ? payload.trajectory.length / Math.max(1, state.duration * 12) : 0,
      recommendations: ["该结果来自导入项目，请按需要复核击球候选"]
    };
    state.restored = false;
    state.currentCacheKey = getAnalysisCacheKey(
      state.file,
      $("sportSelect").value,
      Number($("cutStrength").value),
      Number($("hitSensitivity").value),
      $("analysisPreset").value
    );
    rebuildHighlights();
    initializeEditHistory();
    writeAnalysisCache(state.currentCacheKey, {
      duration: state.duration,
      events: state.events,
      segments: state.segments,
      highlights: state.highlights,
      trajectory: state.trajectory,
      quality: state.analysisQuality
    }).catch(() => {});
    scheduleProjectPersist();
    $("exportBtn").disabled = false;
    $("decisionBtn").disabled = false;
    $("restoreBtn").disabled = false;
    $("addHitBtn").disabled = false;
    $("confirmHighBtn").disabled = false;
    $("previousEventBtn").disabled = false;
    $("nextEventBtn").disabled = false;
    renderAll();
    setLog([
      "剪辑项目已导入。",
      `恢复 ${state.events.length} 个事件、${state.segments.length} 个片段和 ${state.trajectory.length} 个轨迹点。`
    ]);
  } catch (error) {
    setLog(["无法导入剪辑项目。", error.message]);
  } finally {
    $("projectInput").value = "";
  }
}

async function waitForSeek(targetVideo, time) {
  if (Math.abs(targetVideo.currentTime - time) < 0.02) {
    targetVideo.currentTime = time;
    return;
  }
  return new Promise((resolve) => {
    const done = () => {
      targetVideo.removeEventListener("seeked", done);
      resolve();
    };
    targetVideo.addEventListener("seeked", done);
    targetVideo.currentTime = time;
  });
}

function getBestHighlight() {
  return state.highlights.slice().sort((a, b) => b.score - a.score)[0] || null;
}

function locateBestHighlight() {
  const highlight = getBestHighlight();
  if (!highlight) return;
  const event = state.events.find((candidate) => candidate.id === highlight.eventId);
  video.currentTime = event?.timestamp ?? highlight.start;
  updatePlaybackProgress();
  video.play();
}

async function downloadCover() {
  if (!state.file || !video.videoWidth || !video.videoHeight) return;
  const highlight = getBestHighlight();
  const event = highlight
    ? state.events.find((candidate) => candidate.id === highlight.eventId)
    : null;
  const targetTime = event?.timestamp ?? highlight?.start ?? video.currentTime;
  video.pause();
  await waitForSeek(video, clamp(targetTime, 0, state.duration));

  const output = document.createElement("canvas");
  output.width = 1280;
  output.height = 720;
  const outputContext = output.getContext("2d");
  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = output.width / output.height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = video.videoHeight * targetRatio;
    sourceX = (video.videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = video.videoWidth / targetRatio;
    sourceY = (video.videoHeight - sourceHeight) / 2;
  }
  outputContext.drawImage(
    video,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    output.width,
    output.height
  );

  const gradient = outputContext.createLinearGradient(0, 420, 0, 720);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.88)");
  outputContext.fillStyle = gradient;
  outputContext.fillRect(0, 360, output.width, 360);
  outputContext.fillStyle = "#4cc9a4";
  outputContext.fillRect(64, 565, 74, 6);
  outputContext.fillStyle = "#ffffff";
  outputContext.font = '700 54px "Microsoft YaHei", sans-serif';
  outputContext.fillText(`${sportProfiles[$("sportSelect").value].name}训练精彩瞬间`, 64, 640);
  outputContext.font = '400 25px "Microsoft YaHei", sans-serif';
  const summary = buildTrainingSummary();
  outputContext.fillStyle = "rgba(255,255,255,0.82)";
  outputContext.fillText(
    `${summary.activeEvents} 次有效击球 · 最长连续 ${summary.longestSequence} 次 · 精彩分 ${Math.round((highlight?.score || 0) * 100)}`,
    66,
    683
  );
  outputContext.fillStyle = "rgba(255,255,255,0.88)";
  outputContext.font = '700 24px "Microsoft YaHei", sans-serif';
  outputContext.fillText("剪球", 1130, 64);

  const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `jianqiu-cover-${Date.now()}.png`;
  link.click();
  URL.revokeObjectURL(url);
  setLog(["封面已生成。", `使用 ${formatTime(targetTime)} 的最高分精彩画面，本地导出为 1280×720 PNG。`]);
}

function buildSocialCaption() {
  const summary = buildTrainingSummary();
  const sportName = sportProfiles[$("sportSelect").value].name;
  const bestScore = Math.round((getBestHighlight()?.score || 0) * 100);
  const saved = formatTime(summary.removedDuration);
  return [
    `今日${sportName}训练完成`,
    `${summary.activeEvents} 次有效击球，最长连续 ${summary.longestSequence} 次`,
    `最佳精彩分 ${bestScore}，剪掉等待时间 ${saved}`,
    "#剪球 #球类运动 #训练记录"
  ].join("\n");
}

async function copySocialCaption() {
  const caption = buildSocialCaption();
  try {
    await navigator.clipboard.writeText(caption);
    setLog(["发布文案已复制。", caption.replaceAll("\n", " · ")]);
  } catch {
    downloadText(`jianqiu-caption-${Date.now()}.txt`, caption, "text/plain;charset=utf-8");
    setLog(["浏览器未开放剪贴板权限，文案已改为 TXT 下载。"]);
  }
}

async function exportPreview() {
  if (!state.file || !state.duration) return;
  const kept = getExportSegments().slice(0, 12);
  if (!kept.length) {
    setLog(["没有可导出的片段。", "请确认或收藏击球候选，或切换到其他剪辑目标。"]);
    return;
  }
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
  let audioIncluded = false;
  if ($("keepAudio").checked && typeof exportVideo.captureStream === "function") {
    const sourceStream = exportVideo.captureStream();
    sourceStream.getAudioTracks().forEach((track) => {
      stream.addTrack(track);
      audioIncluded = true;
    });
  }
  const recorder = new MediaRecorder(stream, getRecorderOptions(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]));
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  const totalExportSeconds = kept.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  setLog([
    "正在导出带水印预览。",
    `预计约 ${formatRemaining(totalExportSeconds).replace("预计剩余 ", "")}，${audioIncluded ? "已保留原声音轨" : "当前浏览器将导出静音视频"}。`
  ]);
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
  setLog([
    "导出完成。",
    `WebM 水印预览已下载，${audioIncluded ? "包含原声" : "未包含音轨"}；高清 MP4 可在接入 FFmpeg 后启用。`
  ]);
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

function mergeExportSegments(segments) {
  if (!segments.length) return [];
  const sorted = segments
    .map((segment) => ({ ...segment }))
    .sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  sorted.slice(1).forEach((segment) => {
    const previous = merged[merged.length - 1];
    if (segment.start <= previous.end + 0.25) {
      previous.end = Math.max(previous.end, segment.end);
    } else {
      merged.push(segment);
    }
  });
  return merged;
}

function getExportSegments() {
  if ($("modeSelect").value === "highlights") {
    const selected = state.highlights
      .filter((highlight) => highlight.favorite || highlight.score >= 0.7)
      .slice(0, 12);
    return mergeExportSegments(selected);
  }
  return getKeptSegments();
}

function getRecorderOptions(candidates) {
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

function drawExportSegment(exportVideo, outCtx, out, end) {
  return new Promise((resolve) => {
    const profile = sportProfiles[$("sportSelect").value];
    const settings = getEffectSettings(profile);
    const draw = () => {
      if (exportVideo.currentTime >= end || exportVideo.ended) {
        exportVideo.playbackRate = 1;
        resolve();
        return;
      }

      if ($("autoSlowMotion").checked) {
        const nearImpact = getActiveEvents().some((event) =>
          Math.abs(event.timestamp - exportVideo.currentTime) <= 0.5
        );
        exportVideo.playbackRate = nearImpact ? 0.5 : 1;
      } else {
        exportVideo.playbackRate = 1;
      }

      outCtx.fillStyle = "#050607";
      outCtx.fillRect(0, 0, out.width, out.height);
      const scale = Math.min(out.width / exportVideo.videoWidth, out.height / exportVideo.videoHeight);
      const w = exportVideo.videoWidth * scale;
      const h = exportVideo.videoHeight * scale;
      const x = (out.width - w) / 2;
      const y = (out.height - h) / 2;
      outCtx.drawImage(exportVideo, x, y, w, h);

      const exportTrail = state.trajectory
        .filter((point) => point.time <= exportVideo.currentTime && exportVideo.currentTime - point.time < 1.2)
        .slice(-settings.trailPoints);
      if ($("showTrajectory").checked && exportTrail.length > 1) {
        outCtx.save();
        outCtx.strokeStyle = settings.color;
        outCtx.lineWidth = settings.trailWidth;
        outCtx.shadowColor = settings.color;
        outCtx.shadowBlur = settings.glow;
        outCtx.globalAlpha = 0.76;
        outCtx.beginPath();
        exportTrail.forEach((point, index) => {
          const trailX = x + w * point.xNorm;
          const trailY = y + h * point.yNorm;
          if (index === 0) outCtx.moveTo(trailX, trailY);
          else outCtx.lineTo(trailX, trailY);
        });
        outCtx.stroke();
        outCtx.restore();
      }

      if ($("showImpact").checked) state.events
        .filter((event) => Math.abs(event.timestamp - exportVideo.currentTime) < 0.6)
        .forEach((event) => {
          const pulse = 1 - Math.abs(event.timestamp - exportVideo.currentTime) / 0.6;
          if (!event.position) return;
          const ex = x + w * event.position.x;
          const ey = y + h * event.position.y;
          outCtx.save();
          outCtx.globalAlpha = pulse;
          outCtx.strokeStyle = settings.color;
          outCtx.lineWidth = settings.lineWidth * 1.5;
          outCtx.shadowColor = settings.color;
          outCtx.shadowBlur = settings.glow;
          outCtx.beginPath();
          outCtx.arc(ex, ey, settings.radius + 70 * (1 - pulse), 0, Math.PI * 2);
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
  updatePreviewPlaybackRate();
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
$("cancelAnalyzeBtn").addEventListener("click", cancelAnalysis);
$("addHitBtn").addEventListener("click", addHitAtCurrentTime);
$("confirmHighBtn").addEventListener("click", confirmHighConfidenceEvents);
$("undoEditBtn").addEventListener("click", undoEdit);
$("redoEditBtn").addEventListener("click", redoEdit);
$("markCutStartBtn").addEventListener("click", markCutStart);
$("finishCutBtn").addEventListener("click", finishManualCut);
$("eventFilter").addEventListener("change", renderEvents);
$("previousEventBtn").addEventListener("click", () => navigateEvent(-1));
$("nextEventBtn").addEventListener("click", () => navigateEvent(1));
$("calibrateBallBtn").addEventListener("click", startBallColorCalibration);
$("resetBallColorBtn").addEventListener("click", resetBallColor);
document.querySelector(".player-frame").addEventListener("click", sampleBallColor);
$("demoBtn").addEventListener("click", createDemoVideo);
$("importProjectBtn").addEventListener("click", () => $("projectInput").click());
$("projectInput").addEventListener("change", (event) => importProjectFile(event.target.files[0]));
$("restoreBtn").addEventListener("click", () => {
  state.restored = !state.restored;
  $("restoreBtn").textContent = state.restored ? "重新删除" : "恢复全部";
  pushEditHistory();
  scheduleProjectPersist();
  renderAll();
});
$("decisionBtn").addEventListener("click", () => {
  downloadText("jianqiu-edit-decision.json", JSON.stringify(makeDecisionPayload(), null, 2), "application/json");
});
$("downloadReportBtn").addEventListener("click", downloadTrainingReport);
$("bestHighlightBtn").addEventListener("click", locateBestHighlight);
$("downloadCoverBtn").addEventListener("click", downloadCover);
$("copyCaptionBtn").addEventListener("click", copySocialCaption);
$("shotMap").addEventListener("click", locateShotMapEvent);
$("exportBtn").addEventListener("click", exportPreview);
$("timeline").addEventListener("click", (event) => {
  if (!state.duration) return;
  const rect = $("timeline").getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  video.currentTime = ratio * state.duration;
  updatePlaybackProgress();
});
window.addEventListener("resize", sizeCanvasToVideo);
window.addEventListener("keydown", handleEditorShortcut);

renderAll();
checkLocalAnalyzerEnvironment();
resumeActiveAnalysis();
