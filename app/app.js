const state = {
  file: null,
  url: "",
  duration: 0,
  events: [],
  segments: [],
  highlights: [],
  trajectory: [],
  analysisSource: null,
  analysisCapabilities: null,
  analysisQuality: null,
  restored: false,
  raf: 0,
  analyzing: false,
  analysisJobId: null,
  analysisRequest: null,
  analysisPollTimer: 0,
  environmentReady: false,
  ballColor: null,
  calibrationMode: false,
  currentCacheKey: null,
  persistTimer: 0,
  editHistory: [],
  editHistoryIndex: -1,
  pendingCutStart: null,
  positionEventId: null,
  latestAnalysisStats: null,
  exporting: false,
  selectedHistoryKey: "",
  previewReframe: { x: 0.5, y: 0.5 },
  reviewLoop: null,
  excludedExportKeys: new Set(),
  timelineViewportStart: 0
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
const { buildEdl } = window.JianqiuEditFormats;
const { mergeSegments, selectByDuration } = window.JianqiuHighlightSelection;
const { buildExportReadiness } = window.JianqiuExportReadiness;
const { buildCandidateReviewMetrics } = window.JianqiuReviewMetrics;
const { buildAnnotationPayload } = window.JianqiuAnnotationExport;
const video = $("sourceVideo");
const canvas = $("effectCanvas");
const ctx = canvas.getContext("2d");
const analysisDbName = "jianqiu-local-analysis";
const analysisStoreName = "results";
const projectStoreName = "projects";
const historyStoreName = "history";
const activeJobStorageKey = "jianqiu-active-analysis";
const preferenceStorageKey = "jianqiu-editor-preferences-v1";
const preferenceControlIds = [
  "sportSelect",
  "cameraAngle",
  "modeSelect",
  "highlightDuration",
  "ratioSelect",
  "creatorName",
  "smartReframe",
  "effectStyle",
  "showTrajectory",
  "showImpact",
  "showActivityRegion",
  "cutStrength",
  "highlightThreshold",
  "hitSensitivity",
  "analysisPreset",
  "reuseCache",
  "keepAudio",
  "autoSlowMotion",
  "smartSkip",
  "reviewPlaybackRate",
  "timelineZoom"
];

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getBrandLabel() {
  return $("creatorName").value.trim().slice(0, 40) || "剪球 AI Preview";
}

function updateBrandUi() {
  $("previewWatermark").textContent = getBrandLabel();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setLog(lines) {
  $("progressLog").innerHTML = lines.map((line) => `<div>${line}</div>`).join("");
}

function setProjectSaveStatus(status, message) {
  const label = $("projectSaveStatus");
  label.className = `project-save-status ${status || ""}`.trim();
  label.textContent = message;
}

function saveEditorPreferences() {
  const preferences = {};
  preferenceControlIds.forEach((id) => {
    const control = $(id);
    if (!control) return;
    preferences[id] = control.type === "checkbox" ? control.checked : control.value;
  });
  try {
    localStorage.setItem(preferenceStorageKey, JSON.stringify(preferences));
  } catch {
    // The editor remains usable when browser storage is disabled.
  }
}

function loadEditorPreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem(preferenceStorageKey) || "{}");
    preferenceControlIds.forEach((id) => {
      const control = $(id);
      const value = preferences[id];
      if (!control || value == null) return;
      if (control.type === "checkbox") {
        control.checked = Boolean(value);
        return;
      }
      if (control instanceof HTMLSelectElement) {
        const allowed = [...control.options].some((option) => option.value === String(value));
        if (allowed) control.value = String(value);
        return;
      }
      const minimum = Number(control.min);
      const maximum = Number(control.max);
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        control.value = String(clamp(
          numeric,
          Number.isFinite(minimum) ? minimum : numeric,
          Number.isFinite(maximum) ? maximum : numeric
        ));
      }
    });
  } catch {
    localStorage.removeItem(preferenceStorageKey);
  }
  $("highlightThresholdValue").textContent = `${$("highlightThreshold").value} 分`;
  $("highlightDuration").disabled = $("modeSelect").value !== "highlights";
}

async function checkLocalAnalyzerEnvironment(announce = false) {
  try {
    const response = await fetch("/api/system", { cache: "no-store" });
    const environment = await response.json();
    if (!response.ok || !environment.ready) {
      state.environmentReady = false;
      $("analyzeBtn").disabled = true;
      setLog([
        "本地 OpenCV 环境尚未就绪。",
        environment.error || "缺少 Python、OpenCV 或 NumPy。",
        environment.installCommand || "python -m pip install opencv-python numpy"
      ]);
      return false;
    }
    state.environmentReady = true;
    $("analyzeBtn").disabled = !state.file || state.analyzing;
    document.querySelector(".privacy-pill").textContent =
      `本地处理 · 服务 ${environment.serviceVersion} · Python ${environment.python} · OpenCV ${environment.opencv}`;
    if (announce) {
      setLog(["本地服务连接正常。", `OpenCV ${environment.opencv} 已就绪，可以继续分析。`]);
    }
    return true;
  } catch {
    state.environmentReady = false;
    $("analyzeBtn").disabled = true;
    setLog(["无法读取本地分析环境状态，请确认剪球服务仍在运行。"]);
    return false;
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

function formatEtaWithClock(seconds) {
  const remaining = formatRemaining(seconds);
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return remaining;
  const finish = new Date(Date.now() + seconds * 1000);
  const clock = finish.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${remaining} · 约 ${clock} 完成`;
}

function formatBytesPerSecond(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function renderVideoPreflight() {
  if (!state.file || !state.duration || !video.videoWidth || !video.videoHeight) {
    $("videoPreflight").textContent = "载入后显示素材预检";
    return;
  }
  const preset = $("analysisPreset").value;
  const estimated = getEstimatedAnalysisSeconds(state.duration, preset);
  const warnings = [];
  if (state.file.size > 900 * 1024 * 1024) warnings.push("接近 1GB 上限");
  if (video.videoWidth >= 3840) warnings.push("4K 将自动缩小分析");
  if (video.videoHeight > video.videoWidth) warnings.push("竖屏素材建议启用智能跟拍");
  $("videoPreflight").textContent =
    `${video.videoWidth}×${video.videoHeight} · ${formatFileSize(state.file.size)} · ` +
    `${formatTime(state.duration)} · ${formatRemaining(estimated).replace("预计剩余 ", "分析约 ")}` +
    (warnings.length ? ` · ${warnings.join(" · ")}` : " · 素材规格正常");
}

function getBenchmarkKey(preset) {
  return `jianqiu-processing-ratio-${preset}`;
}

function getEstimatedAnalysisSeconds(duration, preset) {
  const defaults = { fast: 0.36, standard: 0.52, precise: 0.74 };
  const saved = Number(localStorage.getItem(getBenchmarkKey(preset)));
  const ratio = Number.isFinite(saved) && saved > 0 ? saved : defaults[preset] || defaults.standard;
  return Math.max(4, duration * ratio);
}

function updateProcessingBenchmark(preset, elapsedSeconds, duration) {
  if (!duration || !elapsedSeconds) return;
  const measured = elapsedSeconds / duration;
  const key = getBenchmarkKey(preset);
  const previous = Number(localStorage.getItem(key));
  const calibrated = Number.isFinite(previous) && previous > 0
    ? previous * 0.65 + measured * 0.35
    : measured;
  localStorage.setItem(key, String(clamp(calibrated, 0.1, 4)));
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
    const request = indexedDB.open(analysisDbName, 3);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(analysisStoreName)) {
        db.createObjectStore(analysisStoreName, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(projectStoreName)) {
        db.createObjectStore(projectStoreName, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(historyStoreName)) {
        db.createObjectStore(historyStoreName, { keyPath: "key" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function getAnalysisCacheKey(file, sport, strength, sensitivity, preset, cameraAngle) {
  return [
    "v4",
    file.name,
    file.size,
    file.lastModified,
    sport,
    strength,
    sensitivity,
    preset,
    cameraAngle,
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
  state.positionEventId = null;
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
  const point = normalizedVideoPoint(event);
  if (!point) return;
  const sourceX = Math.floor(point.x * video.videoWidth);
  const sourceY = Math.floor(point.y * video.videoHeight);
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

function normalizedVideoPoint(event) {
  const rect = video.getBoundingClientRect();
  const content = getContainedRect(
    rect.width,
    rect.height,
    video.videoWidth || rect.width,
    video.videoHeight || rect.height
  );
  const left = rect.left + content.x;
  const top = rect.top + content.y;
  if (
    event.clientX < left ||
    event.clientX > left + content.width ||
    event.clientY < top ||
    event.clientY > top + content.height
  ) return null;
  return {
    x: clamp((event.clientX - left) / content.width, 0, 1),
    y: clamp((event.clientY - top) / content.height, 0, 1)
  };
}

function handlePlayerFrameClick(event) {
  if (state.positionEventId) {
    const point = normalizedVideoPoint(event);
    if (!point) return;
    const target = state.events.find((candidate) => candidate.id === state.positionEventId);
    if (target) {
      target.position = point;
      target.reviewStatus = "confirmed";
      rebuildHighlights();
      pushEditHistory();
      scheduleProjectPersist();
      renderAll();
      setLog(["击球锚点已更新。", "预览、封面和导出将使用新的位置。"]);
    }
    state.positionEventId = null;
    document.querySelector(".player-frame").classList.remove("calibrating");
    return;
  }
  sampleBallColor(event);
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

function clearLocalAnalysisData() {
  if (!window.confirm("确认删除本机的分析缓存、人工审阅和训练历史吗？原视频文件不会被删除。")) return;
  if (state.analysisRequest && state.analysisRequest.readyState !== XMLHttpRequest.DONE) {
    state.analysisRequest.abort();
  }
  if (state.analysisJobId) {
    fetch(`/api/analyze/cancel?id=${encodeURIComponent(state.analysisJobId)}`, {
      method: "DELETE"
    }).catch(() => {});
  }
  sessionStorage.removeItem(activeJobStorageKey);
  const request = indexedDB.deleteDatabase(analysisDbName);
  request.addEventListener("success", () => {
    setLog(["本机分析数据已清除。", "原视频文件未被修改或删除。"]);
  });
  request.addEventListener("error", () => {
    setLog(["清除本机分析数据失败。", request.error?.message || "请关闭其他剪球页面后重试。"]);
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

async function writeTrainingHistory() {
  if (!state.currentCacheKey || !state.analysisQuality || !state.file) return;
  const db = await openAnalysisDb();
  const summary = buildTrainingSummary();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(historyStoreName, "readwrite");
    transaction.objectStore(historyStoreName).put({
      key: state.currentCacheKey,
      fileName: state.file.name,
      sport: $("sportSelect").value,
      updatedAt: Date.now(),
      summary
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

async function readTrainingHistory() {
  const db = await openAnalysisDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(historyStoreName, "readonly");
    const request = transaction.objectStore(historyStoreName).getAll();
    request.addEventListener("success", () => {
      resolve(
        request.result
          .filter((item) => item.sport === $("sportSelect").value)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 6)
      );
    });
    request.addEventListener("error", () => reject(request.error));
    transaction.addEventListener("complete", () => db.close());
  });
}

async function deleteTrainingHistory(key) {
  const db = await openAnalysisDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(historyStoreName, "readwrite");
    transaction.objectStore(historyStoreName).delete(key);
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
    restored: state.restored,
    excludedExportKeys: [...state.excludedExportKeys]
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
  state.excludedExportKeys = new Set(
    Array.isArray(edits.excludedExportKeys) ? edits.excludedExportKeys.map(String) : []
  );
  $("restoreBtn").textContent = state.restored ? "重新删除" : "恢复全部";
  state.events.sort((a, b) => a.timestamp - b.timestamp);
  rebuildHighlights();
}

function scheduleProjectPersist() {
  if (!state.currentCacheKey || !state.analysisQuality) return;
  clearTimeout(state.persistTimer);
  setProjectSaveStatus("saving", "正在保存本机项目...");
  state.persistTimer = setTimeout(() => {
    Promise.all([
      writeProjectEdits(state.currentCacheKey, snapshotProjectEdits()),
      writeTrainingHistory().then(renderTrainingHistory)
    ])
      .then(() => {
        setProjectSaveStatus("saved", `已保存 · ${new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })}`);
      })
      .catch(() => {
        setProjectSaveStatus("error", "本机项目保存失败");
      });
  }, 250);
}

function applyAnalysisResult(result) {
  state.duration = result.duration || state.duration;
  state.analysisSource = result.source || null;
  state.analysisCapabilities = result.capabilities || null;
  state.excludedExportKeys = new Set();
  state.events = (result.events || []).map((event) => ({
    ...event,
    reviewStatus: "unreviewed",
    source: "opencv",
    favorite: false,
    shotType: event.suggestedShotType || "unclassified",
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
  $("analyzeBtn").disabled = !state.environmentReady;
  $("exportBtn").disabled = true;
  $("decisionBtn").disabled = true;
  $("restoreBtn").disabled = true;
  $("addHitBtn").disabled = true;
  $("confirmHighBtn").disabled = true;
  $("markCutStartBtn").disabled = true;
  $("finishCutBtn").disabled = true;
  state.pendingCutStart = null;
  state.positionEventId = null;
  state.reviewLoop = null;
  state.excludedExportKeys = new Set();
  state.timelineViewportStart = 0;
  $("previousEventBtn").disabled = true;
  $("nextEventBtn").disabled = true;
  $("previousFrameBtn").disabled = false;
  $("nextFrameBtn").disabled = false;
  $("calibrateBallBtn").disabled = false;
  state.events = [];
  state.segments = [];
  state.highlights = [];
  state.trajectory = [];
  state.analysisSource = null;
  state.analysisCapabilities = null;
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
  setProjectSaveStatus("", "等待分析后建立本地项目");
  renderAll();
  setLog(["视频已载入，等待读取时长。", "本地模式不会把文件发送到网络。"]);
}

async function generateAnalysis() {
  if (!state.file || state.analyzing) return;
  if (!state.environmentReady) {
    await checkLocalAnalyzerEnvironment(true);
    if (!state.environmentReady) return;
  }
  const sport = $("sportSelect").value;
  const profile = sportProfiles[sport];
  const strength = Number($("cutStrength").value);
  const sensitivity = Number($("hitSensitivity").value);
  const preset = $("analysisPreset").value;
  const cameraAngle = $("cameraAngle").value;
  const cacheKey = getAnalysisCacheKey(
    state.file, sport, strength, sensitivity, preset, cameraAngle
  );
  state.currentCacheKey = cacheKey;
  state.analyzing = true;
  state.analysisJobId = null;
  state.latestAnalysisStats = null;
  $("analyzeBtn").disabled = true;
  $("analyzeBtn").textContent = "OpenCV 正在逐帧分析...";
  showAnalysisProgress({
    phase: "正在上传到本机分析器",
    percent: 0,
    eta: formatEtaWithClock(getEstimatedAnalysisSeconds(state.duration, preset)),
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
        setProjectSaveStatus("saved", "已恢复本机项目");
        return;
      }
    }

    const job = await uploadAnalysisJob(
      state.file,
      sport,
      strength,
      sensitivity,
      preset,
      cameraAngle,
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
    if (state.latestAnalysisStats) {
      updateProcessingBenchmark(
        preset,
        state.latestAnalysisStats.elapsedSeconds,
        state.latestAnalysisStats.totalSeconds || state.duration
      );
    }
    applyAnalysisResult(result);
    initializeEditHistory();
    await writeAnalysisCache(cacheKey, result).catch(() => {});
    await writeProjectEdits(cacheKey, snapshotProjectEdits()).catch(() => {});
    await writeTrainingHistory().catch(() => {});
    setProjectSaveStatus("saved", "分析结果已保存到本机");

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
    $("analyzeBtn").disabled = !state.environmentReady;
    $("analyzeBtn").textContent = "开始本地分析";
    hideAnalysisProgress();
  }
}

function uploadAnalysisJob(file, sport, strength, sensitivity, preset, cameraAngle, ballColor, cacheKey) {
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
      `/api/analyze/start?sport=${encodeURIComponent(sport)}&strength=${strength}&sensitivity=${sensitivity}&preset=${encodeURIComponent(preset)}&cameraAngle=${encodeURIComponent(cameraAngle)}${ballQuery}`
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
        eta: formatEtaWithClock(eta),
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
    setProjectSaveStatus("saved", "导入项目已保存到本机");
  } catch (error) {
    setLog(["后台分析任务未能恢复。", error.message]);
  } finally {
    clearTimeout(state.analysisPollTimer);
    state.analysisPollTimer = 0;
    state.analysisJobId = null;
    state.analyzing = false;
    sessionStorage.removeItem(activeJobStorageKey);
    hideAnalysisProgress();
    $("analyzeBtn").disabled = !state.file || !state.environmentReady;
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
      eta: formatEtaWithClock(job.etaSeconds),
      speed: job.processingFps ? `${job.processingFps.toFixed(1)} 帧/s` : ""
    });

    if (job.status === "completed") {
      state.latestAnalysisStats = {
        elapsedSeconds: job.elapsedSeconds,
        totalSeconds: job.totalSeconds,
        processingFps: job.processingFps
      };
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

function getReviewStats() {
  const reviewed = state.events.filter((event) =>
    event.reviewStatus === "confirmed" ||
    event.reviewStatus === "ignored" ||
    event.source === "manual"
  ).length;
  return {
    reviewed,
    total: state.events.length,
    remaining: Math.max(0, state.events.length - reviewed)
  };
}

function getUnreviewedEvents() {
  return state.events
    .filter((event) => event.reviewStatus === "unreviewed" && event.source !== "manual")
    .sort((a, b) => a.timestamp - b.timestamp);
}

function navigateNextUnreviewed() {
  const candidates = getUnreviewedEvents();
  if (!candidates.length) {
    setLog(["候选击球已全部复核。", "可以继续检查精彩集锦、训练报告或导出 EDL。"]);
    return;
  }
  const next = candidates.find((event) => event.timestamp > video.currentTime + 0.15) || candidates[0];
  setReviewLoop(next);
  centerTimelineOn(next.timestamp);
  video.currentTime = next.timestamp;
  video.pause();
  updatePlaybackProgress();
  setLog([
    `待确认候选 ${formatTime(next.timestamp)}。`,
    formatEvidence(next.evidence)
  ]);
}

function confirmCurrentAndContinue() {
  const candidates = getUnreviewedEvents();
  if (!candidates.length) {
    navigateNextUnreviewed();
    return;
  }
  const nearest = candidates.reduce((best, event) => {
    const distance = Math.abs(event.timestamp - video.currentTime);
    return !best || distance < best.distance ? { event, distance } : best;
  }, null);
  const target = nearest?.distance <= 2 ? nearest.event : candidates[0];
  target.reviewStatus = "confirmed";
  rebuildHighlights();
  pushEditHistory();
  scheduleProjectPersist();
  renderAll();
  video.currentTime = target.timestamp + 0.2;
  navigateNextUnreviewed();
}

function getHighlightThreshold() {
  return Number($("highlightThreshold").value) / 100;
}

function getSelectedHighlights() {
  const threshold = getHighlightThreshold();
  return state.highlights.filter((highlight) => highlight.favorite || highlight.score >= threshold);
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
  const intervalDeviation = intervals.length && averageInterval
    ? Math.sqrt(
      intervals.reduce((sum, value) => sum + (value - averageInterval) ** 2, 0) / intervals.length
    )
    : null;
  const intervalConsistency = intervalDeviation == null || !averageInterval
    ? null
    : clamp(1 - intervalDeviation / averageInterval, 0, 1);
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
  const candidateReview = buildCandidateReviewMetrics(state.events);
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
    intervalDeviation,
    intervalConsistency,
    longestSequence,
    fastestSpeed,
    keptRatio,
    reviewRate,
    candidateReview,
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

function buildRallies() {
  const events = getActiveEvents().slice().sort((a, b) => a.timestamp - b.timestamp);
  if (!events.length) return [];
  const groups = [[events[0]]];
  events.slice(1).forEach((event) => {
    const group = groups[groups.length - 1];
    const previous = group[group.length - 1];
    if (event.timestamp - previous.timestamp <= 8) group.push(event);
    else groups.push([event]);
  });
  return groups.map((group, index) => {
    const scores = group.map((event) => getHighlightScore(event, events));
    return {
      id: `rally_${index + 1}`,
      start: clamp(group[0].timestamp - 1.5, 0, state.duration),
      end: clamp(group[group.length - 1].timestamp + 2, 0, state.duration),
      hitCount: group.length,
      score: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      favorite: group.some((event) => event.favorite),
      timestamp: group.reduce((sum, event) => sum + event.timestamp, 0) / group.length,
      events: group
    };
  });
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
    [
      "候选命中率",
      summary.candidateReview.precision == null
        ? "--"
        : `${Math.round(summary.candidateReview.precision * 100)}%`
    ],
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
  renderDataInsights(summary);
  renderEvidenceDistribution();
  renderShotMap();
  renderCapabilityDisclosure();
  renderExportPlan();
  renderExportReadiness();
  renderTrainingHistory();
  renderRallies();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function renderEvidenceDistribution() {
  const events = getActiveEvents();
  const metrics = [
    {
      label: "置信度中位数",
      value: median(events.map((event) => Number(event.confidence) || 0)),
      display: (value) => `${Math.round(value * 100)}%`,
      maximum: 1
    },
    {
      label: "方向变化中位数",
      value: median(events.map((event) => Number(event.evidence?.directionChangeDegrees) || 0)),
      display: (value) => `${Math.round(value)}°`,
      maximum: 180
    },
    {
      label: "击球后画面球速",
      value: median(events.map((event) => Number(event.evidence?.speedAfterPxPerSec) || 0)),
      display: (value) => `${Math.round(value)} px/s`,
      maximum: 650
    },
    {
      label: "轨迹连续度",
      value: median(events.map((event) => Number(event.evidence?.trackContinuity) || 0)),
      display: (value) => `${Math.round(value * 100)}%`,
      maximum: 1
    }
  ];
  $("evidenceDistribution").innerHTML = metrics.map((metric) => `
    <div class="evidence-metric">
      <span>${metric.label}</span>
      <strong>${events.length ? metric.display(metric.value) : "--"}</strong>
      <div class="evidence-meter"><i style="width:${events.length ? clamp(metric.value / metric.maximum, 0, 1) * 100 : 0}%"></i></div>
      <small>${events.length} 个有效候选</small>
    </div>
  `).join("");
}

function buildDataInsights(summary) {
  const insights = [];
  if (summary.activeEvents < 4) {
    insights.push(["样本量", "当前有效候选较少，暂不适合判断动作趋势，建议先完成复核或增加训练时长。"]);
  } else if (summary.intervalConsistency != null) {
    insights.push([
      "击球节奏",
      summary.intervalConsistency >= 0.72
        ? "本次击球间隔相对稳定，可结合回合列表定位连续性较好的片段。"
        : "本次击球间隔波动较大，可能包含发球准备、捡球或不同训练内容，建议分段比较。"
    ]);
  }
  insights.push([
    "有效运动",
    summary.keptRatio >= 0.65
      ? "视频中有效运动占比较高，适合直接生成训练记录。"
      : "等待和镜头中断占比较高，导出前建议逐段检查自动删除区间。"
  ]);
  if (summary.longestSequence >= 4) {
    insights.push(["连续性", `最长连续识别到 ${summary.longestSequence} 次击球，可优先复看对应回合。`]);
  }
  if (summary.reviewRate < 1) {
    insights.push(["可信度", `仍有 ${Math.max(0, state.events.length - Math.round(summary.reviewRate * state.events.length))} 个候选未复核，数据提示会随确认或忽略实时变化。`]);
  }
  if (summary.candidateReview.reviewed >= 3) {
    insights.push([
      "候选命中率",
      summary.candidateReview.precision >= 0.75
        ? `已复核 ${summary.candidateReview.reviewed} 个模型候选，确认命中率 ${Math.round(summary.candidateReview.precision * 100)}%，当前参数误报较少。`
        : `已复核 ${summary.candidateReview.reviewed} 个模型候选，确认命中率 ${Math.round(summary.candidateReview.precision * 100)}%，建议改用保守灵敏度或校准球颜色。`
    ]);
  }
  const classified = Object.entries(summary.shotTypes)
    .filter(([type]) => type !== "unclassified")
    .reduce((sum, [, count]) => sum + count, 0);
  if (summary.activeEvents && classified / summary.activeEvents < 0.5) {
    insights.push(["动作标签", "超过一半击球尚未分类；补充正手、反手、发球等标签后，训练历史更适合横向比较。"]);
  }
  return insights;
}

function renderDataInsights(summary) {
  $("dataInsights").innerHTML = buildDataInsights(summary)
    .map(([label, message]) => `
      <div class="data-insight">
        <span>${label}</span>
        <p>${escapeAttribute(message)}</p>
      </div>
    `)
    .join("");
}

function renderExportPlan() {
  const list = $("exportPlanList");
  const rawSegments = getRawExportSegments();
  const segments = rawSegments.filter((segment) =>
    !state.excludedExportKeys.has(exportSegmentKey(segment))
  );
  if (!rawSegments.length) {
    $("exportPlanSummary").textContent = "当前设置没有可导出片段";
    list.innerHTML = "<span>请调整精彩阈值、集锦时长或恢复需要保留的片段。</span>";
    return;
  }
  const sourceDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const slowMotionEvents = $("autoSlowMotion").checked
    ? getActiveEvents().filter((event) =>
      segments.some((segment) => event.timestamp >= segment.start && event.timestamp <= segment.end)
    ).length
    : 0;
  const estimatedOutputDuration = sourceDuration + slowMotionEvents;
  const modeLabel = {
    balanced: "综合剪辑",
    cutIdle: "删除等待",
    highlights: "精彩集锦",
    effects: "击球特效"
  }[$("modeSelect").value] || "当前模式";
  $("exportPlanSummary").textContent =
    `${modeLabel} · 已选 ${segments.length} / ${rawSegments.length} 段 · 原速 ${formatTime(sourceDuration)}` +
    (slowMotionEvents ? ` · 慢放后约 ${formatTime(estimatedOutputDuration)}` : "");
  list.innerHTML = "";
  rawSegments.slice(0, 20).forEach((segment, index) => {
    const key = exportSegmentKey(segment);
    const included = !state.excludedExportKeys.has(key);
    const row = document.createElement("div");
    row.className = "export-plan-row";
    row.innerHTML = `
      <input type="checkbox" aria-label="包含片段 ${index + 1}" ${included ? "checked" : ""} />
      <strong>${String(index + 1).padStart(2, "0")}</strong>
      <span>${formatTime(segment.start)}–${formatTime(segment.end)}</span>
      <span>${formatTime(segment.end - segment.start)}</span>
      <button type="button">播放</button>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) state.excludedExportKeys.delete(key);
      else state.excludedExportKeys.add(key);
      pushEditHistory();
      scheduleProjectPersist();
      renderExportPlan();
      renderExportReadiness();
    });
    row.querySelector("button").addEventListener("click", () => {
      state.reviewLoop = null;
      video.currentTime = segment.start;
      video.play();
    });
    list.appendChild(row);
  });
}

function renderExportReadiness() {
  const segments = getRawExportSegments().filter((segment) =>
    !state.excludedExportKeys.has(exportSegmentKey(segment))
  );
  const sourceDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const slowMotionEvents = $("autoSlowMotion").checked
    ? getActiveEvents().filter((event) =>
      segments.some((segment) => event.timestamp >= segment.start && event.timestamp <= segment.end)
    ).length
    : 0;
  const review = getReviewStats();
  const readiness = buildExportReadiness({
    analysisReady: Boolean(state.analysisQuality),
    totalCandidates: review.total,
    reviewedCandidates: review.reviewed,
    segmentCount: segments.length,
    outputSeconds: sourceDuration + slowMotionEvents,
    trajectoryCoverage: Number(state.analysisQuality?.coverage) || 0,
    mediaRecorderSupported: typeof MediaRecorder !== "undefined" && typeof canvas.captureStream === "function",
    audioRequested: $("keepAudio").checked,
    audioSupported: typeof video.captureStream === "function"
  });
  const summary = $("exportReadinessSummary");
  summary.className = readiness.level;
  summary.textContent = readiness.level === "ready"
    ? "已就绪"
    : readiness.level === "error"
      ? `${readiness.errors} 项未就绪`
      : `${readiness.warnings} 项建议检查`;
  $("exportReadinessList").innerHTML = readiness.items.map((item) => `
    <div class="${item.level}">
      <i aria-hidden="true">${item.level === "ready" ? "✓" : item.level === "error" ? "×" : "!"}</i>
      <span>${escapeAttribute(item.label)}</span>
      <small>${escapeAttribute(item.detail)}</small>
    </div>
  `).join("");
  $("exportBtn").title = readiness.level === "ready"
    ? "导出检查已通过"
    : "仍可导出，建议先查看导出准备度";
}

function renderCapabilityDisclosure() {
  const container = $("capabilityDisclosure");
  const capabilities = state.analysisCapabilities;
  if (!capabilities) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const labels = {
    ballTracking: "球轨迹",
    cameraMotion: "镜头运动",
    playerLocalization: "人体位置",
    poseDetection: "人体姿态",
    racketDetection: "球拍检测",
    hitDecision: "击球判据"
  };
  $("capabilityList").innerHTML = Object.entries(capabilities).map(([key, capability]) => `
    <div class="${capability.enabled ? "enabled" : "disabled"}">
      <span>${labels[key] || key}</span>
      <strong>${capability.enabled ? "已启用" : "未启用"}</strong>
      <small>${escapeAttribute(capability.method || "")}</small>
    </div>
  `).join("");
}

function renderRallies() {
  const list = $("rallyList");
  const rallies = buildRallies().sort((a, b) => b.score - a.score);
  if (!rallies.length) {
    list.innerHTML = "<span>暂无可用回合。</span>";
    return;
  }
  list.innerHTML = "";
  rallies.forEach((rally, index) => {
    const row = document.createElement("div");
    row.className = "rally-row";
    row.innerHTML = `
      <strong>回合 ${index + 1}</strong>
      <span>${formatTime(rally.start)}–${formatTime(rally.end)}</span>
      <span>${rally.hitCount} 击 · ${Math.round(rally.score * 100)} 分</span>
      <button type="button">播放</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      video.currentTime = rally.start;
      video.play();
    });
    list.appendChild(row);
  });
}

async function renderTrainingHistory() {
  const list = $("trainingHistoryList");
  const comparison = $("trainingComparison");
  const baselineSelect = $("historyBaselineSelect");
  if (!state.analysisQuality) {
    list.innerHTML = "";
    comparison.hidden = true;
    return;
  }
  const history = await readTrainingHistory().catch(() => []);
  if (!history.length) {
    list.innerHTML = "<span>完成本次分析后会生成本机训练记录。</span>";
    baselineSelect.innerHTML = '<option value="">暂无可对比记录</option>';
    comparison.hidden = true;
    drawHistoryChart([]);
    return;
  }
  drawHistoryChart(history.slice().reverse());
  const baselines = history.filter((item) => item.key !== state.currentCacheKey);
  if (!baselines.some((item) => item.key === state.selectedHistoryKey)) {
    state.selectedHistoryKey = baselines[0]?.key || "";
  }
  baselineSelect.innerHTML = baselines.length
    ? baselines.map((item) => `
      <option value="${escapeAttribute(item.key)}"${item.key === state.selectedHistoryKey ? " selected" : ""}>
        ${escapeAttribute(new Date(item.updatedAt).toLocaleDateString("zh-CN"))} · ${escapeAttribute(item.fileName)}
      </option>
    `).join("")
    : '<option value="">还没有上一条训练记录</option>';
  const baseline = baselines.find((item) => item.key === state.selectedHistoryKey);
  renderTrainingComparison(buildTrainingSummary(), baseline?.summary || null);
  list.innerHTML = history.map((item) => `
    <div class="history-row" data-history-key="${escapeAttribute(item.key)}">
      <strong>${escapeAttribute(item.fileName)}</strong>
      <span>${new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
      <span>击球 ${item.summary.activeEvents} · ${item.summary.duration ? (item.summary.activeEvents / (item.summary.duration / 60)).toFixed(1) : "0.0"}/分</span>
      <span>连续 ${item.summary.longestSequence}</span>
      <span>有效 ${Math.round(item.summary.keptRatio * 100)}%</span>
      <span>命中 ${item.summary.candidateReview?.precision == null ? "--" : `${Math.round(item.summary.candidateReview.precision * 100)}%`}</span>
      <button type="button" aria-label="删除训练记录">删除</button>
    </div>
  `).join("");
  list.querySelectorAll(".history-row").forEach((row) => {
    row.querySelector("button").addEventListener("click", async () => {
      const key = row.dataset.historyKey;
      if (!key) return;
      await deleteTrainingHistory(key);
      if (state.selectedHistoryKey === key) state.selectedHistoryKey = "";
      renderTrainingHistory();
      setLog(["训练历史记录已从本机删除。", "原视频、当前分析结果和其他历史记录未受影响。"]);
    });
  });
}

function renderTrainingComparison(current, baseline) {
  const comparison = $("trainingComparison");
  if (!baseline) {
    comparison.hidden = true;
    return;
  }
  comparison.hidden = false;
  const rate = (summary) => summary.duration
    ? summary.activeEvents / (summary.duration / 60)
    : 0;
  const signed = (value, digits = 0) => {
    const rounded = Number(value.toFixed(digits));
    return `${rounded > 0 ? "+" : ""}${rounded}`;
  };
  const metrics = [
    {
      label: "每分钟有效击球",
      current: rate(current),
      baseline: rate(baseline),
      format: (value) => value.toFixed(1),
      delta: (a, b) => a - b,
      suffix: " 次"
    },
    {
      label: "最长连续击球",
      current: current.longestSequence,
      baseline: baseline.longestSequence,
      format: (value) => String(value),
      delta: (a, b) => a - b,
      suffix: " 次"
    },
    {
      label: "有效运动比例",
      current: current.keptRatio * 100,
      baseline: baseline.keptRatio * 100,
      format: (value) => `${Math.round(value)}%`,
      delta: (a, b) => a - b,
      suffix: " 个百分点"
    },
    {
      label: "识别可信度",
      current: current.trustScore * 100,
      baseline: baseline.trustScore * 100,
      format: (value) => `${Math.round(value)}%`,
      delta: (a, b) => a - b,
      suffix: " 个百分点"
    }
  ];
  $("trainingComparisonMetrics").innerHTML = metrics.map((metric) => {
    const difference = metric.delta(metric.current, metric.baseline);
    const tone = difference > 0.05 ? "positive" : difference < -0.05 ? "negative" : "neutral";
    return `
      <div>
        <span>${metric.label}</span>
        <strong>${metric.format(metric.current)}</strong>
        <small class="${tone}">较基线 ${signed(difference, metric.suffix === " 次" ? 1 : 0)}${metric.suffix}</small>
      </div>
    `;
  }).join("");
  const stabilityDrop = (current.cameraStability - baseline.cameraStability) * 100;
  const durationRatio = baseline.duration ? current.duration / baseline.duration : 1;
  const caveats = [];
  if (Math.abs(stabilityDrop) >= 8) {
    caveats.push(`本次机位稳定性${stabilityDrop > 0 ? "提高" : "下降"} ${Math.abs(Math.round(stabilityDrop))} 个百分点`);
  }
  if (durationRatio < 0.65 || durationRatio > 1.55) {
    caveats.push("两次视频时长差异较大，已优先采用每分钟指标");
  }
  $("trainingComparisonNote").textContent = caveats.length
    ? `${caveats.join("；")}。动作表现仍建议在相近机位和训练内容下比较。`
    : "拍摄条件接近时，这组变化更适合判断训练趋势；单次识别结果仍需结合人工复核。";
}

function drawHistoryChart(history) {
  const chart = $("historyChart");
  const chartContext = chart.getContext("2d");
  chartContext.clearRect(0, 0, chart.width, chart.height);
  chartContext.fillStyle = "#101418";
  chartContext.fillRect(0, 0, chart.width, chart.height);
  chartContext.strokeStyle = "rgba(255,255,255,0.12)";
  chartContext.lineWidth = 1;
  for (let row = 1; row <= 3; row += 1) {
    const y = (chart.height / 4) * row;
    chartContext.beginPath();
    chartContext.moveTo(34, y);
    chartContext.lineTo(chart.width - 20, y);
    chartContext.stroke();
  }
  if (!history.length) {
    chartContext.fillStyle = "rgba(255,255,255,0.46)";
    chartContext.font = "13px sans-serif";
    chartContext.fillText("暂无历史趋势", 24, 30);
    return;
  }

  const hitRate = (item) => item.summary.duration
    ? item.summary.activeEvents / (item.summary.duration / 60)
    : 0;
  const maximumHits = Math.max(1, ...history.map(hitRate));
  const pointFor = (item, index, key) => {
    const x = history.length === 1
      ? chart.width / 2
      : 34 + (index / (history.length - 1)) * (chart.width - 54);
    const ratio = key === "hits"
      ? hitRate(item) / maximumHits
      : item.summary.keptRatio;
    return { x, y: chart.height - 25 - ratio * (chart.height - 50) };
  };
  const drawSeries = (key, color) => {
    chartContext.strokeStyle = color;
    chartContext.fillStyle = color;
    chartContext.lineWidth = 3;
    chartContext.beginPath();
    history.forEach((item, index) => {
      const point = pointFor(item, index, key);
      if (index === 0) chartContext.moveTo(point.x, point.y);
      else chartContext.lineTo(point.x, point.y);
    });
    chartContext.stroke();
    history.forEach((item, index) => {
      const point = pointFor(item, index, key);
      chartContext.beginPath();
      chartContext.arc(point.x, point.y, 4, 0, Math.PI * 2);
      chartContext.fill();
    });
  };
  drawSeries("hits", "#4cc9a4");
  drawSeries("kept", "#f6c85f");
  chartContext.font = "12px sans-serif";
  chartContext.fillStyle = "#4cc9a4";
  chartContext.fillText("每分钟有效击球", 24, 18);
  chartContext.fillStyle = "#f6c85f";
  chartContext.fillText("有效运动比例", 132, 18);
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
  const viewport = getTimelineViewport();
  const viewportDuration = viewport.end - viewport.start;
  const leftPercent = (time) => ((time - viewport.start) / viewportDuration) * 100;
  $("timelineRangeLabel").textContent = viewportDuration >= state.duration - 0.05
    ? "全片"
    : `${formatTime(viewport.start)}–${formatTime(viewport.end)}`;

  const fragment = document.createDocumentFragment();
  state.segments.forEach((segment) => {
    const visibleStart = Math.max(segment.start, viewport.start);
    const visibleEnd = Math.min(segment.end, viewport.end);
    if (visibleEnd <= visibleStart) return;
    const div = document.createElement("button");
    div.type = "button";
    const segmentClass = segment.type === "remove" && segment.reason?.includes("镜头移动")
      ? "camera"
      : segment.type;
    div.className = `segment ${(state.restored || segment.restored) && segment.type === "remove" ? "keep" : segmentClass}`;
    div.style.left = `${leftPercent(visibleStart)}%`;
    div.style.width = `${Math.max(0.35, ((visibleEnd - visibleStart) / viewportDuration) * 100)}%`;
    div.title = `${segment.type === "remove" ? segment.reason : "保留片段"} ${formatTime(segment.start)}-${formatTime(segment.end)}`;
    fragment.appendChild(div);
  });

  getSelectedHighlights().forEach((highlight) => {
    const visibleStart = Math.max(highlight.start, viewport.start);
    const visibleEnd = Math.min(highlight.end, viewport.end);
    if (visibleEnd <= visibleStart) return;
    const div = document.createElement("div");
    div.className = "segment highlight";
    div.style.left = `${leftPercent(visibleStart)}%`;
    div.style.width = `${Math.max(0.4, ((visibleEnd - visibleStart) / viewportDuration) * 100)}%`;
    fragment.appendChild(div);
  });

  getActiveEvents().forEach((event) => {
    if (event.timestamp < viewport.start || event.timestamp > viewport.end) return;
    const marker = document.createElement("div");
    marker.className = "event-marker";
    marker.style.left = `${leftPercent(event.timestamp)}%`;
    marker.title = `${event.label} ${formatTime(event.timestamp)}`;
    fragment.appendChild(marker);
  });

  const playhead = document.createElement("div");
  playhead.id = "timelinePlayhead";
  playhead.className = "timeline-playhead";
  playhead.style.left = `${clamp(leftPercent(video.currentTime), 0, 100)}%`;
  fragment.appendChild(playhead);

  timeline.appendChild(fragment);
}

function getTimelineViewport() {
  const requested = Number($("timelineZoom").value) || 0;
  if (!requested || requested >= state.duration) {
    state.timelineViewportStart = 0;
    return { start: 0, end: state.duration };
  }
  const maximumStart = Math.max(0, state.duration - requested);
  state.timelineViewportStart = clamp(state.timelineViewportStart, 0, maximumStart);
  return {
    start: state.timelineViewportStart,
    end: state.timelineViewportStart + requested
  };
}

function centerTimelineOn(time) {
  const requested = Number($("timelineZoom").value) || 0;
  if (!requested || requested >= state.duration) {
    state.timelineViewportStart = 0;
    return;
  }
  state.timelineViewportStart = clamp(time - requested / 2, 0, state.duration - requested);
}

function renderEvents() {
  const list = $("eventList");
  list.innerHTML = "";
  const review = getReviewStats();
  $("reviewProgress").textContent = `复核 ${review.reviewed} / ${review.total}`;
  $("nextUnreviewedBtn").disabled = review.remaining === 0;
  $("confirmNextBtn").disabled = review.remaining === 0;
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
        <strong>${escapeAttribute(event.label)}</strong>
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
        <button type="button" data-action="relocate">重定位</button>
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
        setReviewLoop(event);
        centerTimelineOn(event.timestamp);
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
      if (action === "relocate") {
        state.positionEventId = event.id;
        state.calibrationMode = false;
        video.currentTime = event.timestamp;
        video.pause();
        document.querySelector(".player-frame").classList.add("calibrating");
        setLog(["击球锚点重定位。", "请点击视频画面中的球或希望显示爆点的位置。"]);
        return;
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
        <span>${formatTime(segment.start)}–${formatTime(segment.end)} · ${escapeAttribute(segment.reason)}</span>
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
  setReviewLoop(target);
  centerTimelineOn(target.timestamp);
  video.currentTime = target.timestamp;
  updatePlaybackProgress();
}

function stepVideoFrame(direction) {
  if (!state.duration) return;
  video.pause();
  state.reviewLoop = null;
  const frameRate = Number(state.analysisSource?.fps) || 30;
  video.currentTime = clamp(video.currentTime + direction / frameRate, 0, state.duration);
  updatePlaybackProgress();
  drawEffects();
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
  } else if (event.key.toLowerCase() === "u") {
    navigateNextUnreviewed();
  } else if (event.key === "," || event.key === "<") {
    stepVideoFrame(-1);
  } else if (event.key === "." || event.key === ">") {
    stepVideoFrame(1);
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
  $("metricEvents").textContent = state.analysisQuality ? String(activeEvents.length) : "--";
  const selectedHighlights = getSelectedHighlights();
  $("metricHighlights").textContent = state.analysisQuality ? String(selectedHighlights.length) : "--";
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

function getContainedRect(containerWidth, containerHeight, sourceWidth, sourceHeight) {
  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height
  };
}

function getCanvasVideoRect() {
  return getContainedRect(
    canvas.width,
    canvas.height,
    video.videoWidth || canvas.width,
    video.videoHeight || canvas.height
  );
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
  const display = getCanvasVideoRect();
  if (!state.events.length || video.paused || video.ended) {
    drawReframeGuide(video.currentTime, display);
    if (!video.paused && !video.ended) {
      state.raf = requestAnimationFrame(drawEffects);
    }
    return;
  }

  const profile = sportProfiles[$("sportSelect").value];
  const settings = getEffectSettings(profile);
  const now = video.currentTime;
  const recent = state.events.filter((event) => Math.abs(event.timestamp - now) < 0.65 && event.position);
  if ($("showActivityRegion").checked) recent.forEach((event) => {
    const region = event.activityRegion;
    if (!region) return;
    const x = display.x + display.width * region.x;
    const y = display.y + display.height * region.y;
    const width = display.width * region.w;
    const height = display.height * region.h;
    ctx.save();
    ctx.strokeStyle = "rgba(76,201,164,0.9)";
    ctx.fillStyle = "rgba(76,201,164,0.12)";
    ctx.lineWidth = Math.max(2, window.devicePixelRatio || 1);
    ctx.setLineDash([8, 6]);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `${Math.max(11, 11 * (window.devicePixelRatio || 1))}px sans-serif`;
    ctx.fillText("活动区域代理", x + 6, Math.max(14, y - 6));
    ctx.restore();
  });
  if ($("showImpact").checked) recent.forEach((event) => {
    const age = Math.abs(event.timestamp - now);
    const pulse = 1 - age / 0.65;
    const x = display.x + display.width * event.position.x;
    const y = display.y + display.height * event.position.y;
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
      const x = display.x + display.width * point.xNorm;
      const y = display.y + display.height * point.yNorm;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }
  if ($("showTrajectory").checked && $("effectStyle").value !== "minimal") trail.forEach((point, index) => {
    const x = display.x + display.width * point.xNorm;
    const y = display.y + display.height * point.yNorm;
    ctx.save();
    ctx.globalAlpha = (index + 1) / Math.max(2, trail.length + 2);
    ctx.fillStyle = settings.color;
    ctx.beginPath();
    ctx.arc(x, y, 4 + index, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  drawReframeGuide(now, display);
  if (!video.paused && !video.ended) {
    state.raf = requestAnimationFrame(drawEffects);
  }
}

function drawReframeGuide(time, display) {
  const ratio = $("ratioSelect").value;
  if (!$("smartReframe").checked || ratio === "source" || !video.videoWidth || !video.videoHeight) return;
  const outputAspect = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1": 1,
    "4:5": 4 / 5
  }[ratio];
  if (!outputAspect) return;
  const focus = getTrackingFocus(time);
  state.previewReframe.x += (focus.x - state.previewReframe.x) * 0.12;
  state.previewReframe.y += (focus.y - state.previewReframe.y) * 0.12;
  const sourceAspect = video.videoWidth / video.videoHeight;
  let frame = { ...display };
  if (sourceAspect > outputAspect) {
    frame.width = display.height * outputAspect;
    frame.x = display.x + clamp(
      state.previewReframe.x * display.width - frame.width / 2,
      0,
      display.width - frame.width
    );
  } else {
    frame.height = display.width / outputAspect;
    frame.y = display.y + clamp(
      state.previewReframe.y * display.height - frame.height / 2,
      0,
      display.height - frame.height
    );
  }

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(display.x, display.y, display.width, Math.max(0, frame.y - display.y));
  ctx.fillRect(display.x, frame.y + frame.height, display.width, Math.max(0, display.y + display.height - frame.y - frame.height));
  ctx.fillRect(display.x, frame.y, Math.max(0, frame.x - display.x), frame.height);
  ctx.fillRect(frame.x + frame.width, frame.y, Math.max(0, display.x + display.width - frame.x - frame.width), frame.height);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(2, window.devicePixelRatio || 1);
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
  ctx.restore();
}

function skipRemovedSegments() {
  if (!$("smartSkip").checked || state.restored || !state.segments.length || video.paused) return;
  const cut = state.segments.find((segment) => segment.type === "remove" && video.currentTime >= segment.start && video.currentTime < segment.end - 0.08);
  if (cut) video.currentTime = cut.end;
}

function updatePreviewPlaybackRate() {
  const baseRate = Number($("reviewPlaybackRate").value) || 1;
  const nearImpact = getActiveEvents().some((event) =>
    Math.abs(event.timestamp - video.currentTime) <= 0.5 &&
    state.highlights.some((highlight) => highlight.eventId === event.id)
  );
  const targetRate = $("autoSlowMotion").checked && nearImpact
    ? Math.min(baseRate, 0.5)
    : baseRate;
  if (video.playbackRate !== targetRate) video.playbackRate = targetRate;
}

function setReviewLoop(event) {
  if (!event) {
    state.reviewLoop = null;
    return;
  }
  state.reviewLoop = {
    eventId: event.id,
    start: clamp(event.timestamp - 1.2, 0, state.duration),
    end: clamp(event.timestamp + 1.5, 0, state.duration)
  };
}

function updateReviewLoop() {
  if (!$("loopReview").checked || !state.reviewLoop || video.paused) return;
  if (video.currentTime >= state.reviewLoop.end || video.currentTime < state.reviewLoop.start - 0.1) {
    video.currentTime = state.reviewLoop.start;
  }
}

function updatePlaybackProgress() {
  let viewport = getTimelineViewport();
  if (video.currentTime < viewport.start || video.currentTime > viewport.end) {
    centerTimelineOn(video.currentTime);
    renderTimeline();
    viewport = getTimelineViewport();
  }
  const progress = viewport.end > viewport.start
    ? clamp((video.currentTime - viewport.start) / (viewport.end - viewport.start), 0, 1)
    : 0;
  const playhead = $("timelinePlayhead");
  if (playhead) playhead.style.left = `${progress * 100}%`;
  $("durationLabel").textContent = `${formatTime(video.currentTime)} / ${formatTime(state.duration)}`;
}

function makeDecisionPayload() {
  return {
    app: "剪球 MVP",
    project_version: 2,
    local_only: true,
    source_file: state.file?.name || "",
    source_fingerprint: state.file ? {
      name: state.file.name,
      size: state.file.size,
      lastModified: state.file.lastModified,
      duration: state.duration
    } : null,
    duration: state.duration,
    sport: $("sportSelect").value,
    mode: $("modeSelect").value,
    ratio: $("ratioSelect").value,
    creator_name: getBrandLabel(),
    events: state.events,
    segments: state.segments,
    highlights: state.highlights
    ,
    trajectory: state.trajectory,
    source: state.analysisSource,
    capabilities: state.analysisCapabilities,
    excluded_export_segments: [...state.excludedExportKeys],
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
  <p class="muted">${escapeHtml(getBrandLabel())} · 本地生成</p>
  <h1>${escapeHtml(sportProfiles[$("sportSelect").value].name)}训练报告</h1>
  <p class="muted">${escapeHtml(state.file?.name || "")} · ${new Date().toLocaleString("zh-CN")}</p>
  <div class="metrics">
    <div class="metric"><span>视频时长</span><strong>${formatTime(summary.duration)}</strong></div>
    <div class="metric"><span>有效运动</span><strong>${Math.round(summary.keptRatio * 100)}%</strong></div>
    <div class="metric"><span>有效击球</span><strong>${summary.activeEvents}</strong></div>
    <div class="metric"><span>识别可信度</span><strong>${summary.trustLabel}</strong></div>
    <div class="metric"><span>候选命中率</span><strong>${summary.candidateReview.precision == null ? "--" : `${Math.round(summary.candidateReview.precision * 100)}%`}</strong></div>
    <div class="metric"><span>平均间隔</span><strong>${summary.averageInterval == null ? "--" : `${summary.averageInterval.toFixed(1)} 秒`}</strong></div>
    <div class="metric"><span>最长连续</span><strong>${summary.longestSequence} 次</strong></div>
    <div class="metric"><span>轨迹覆盖</span><strong>${Math.round(summary.trajectoryCoverage * 100)}%</strong></div>
    <div class="metric"><span>机位稳定</span><strong>${Math.round(summary.cameraStability * 100)}%</strong></div>
  </div>
  <h2>拍摄质量</h2>
  <p>清晰度 ${Math.round(summary.medianSharpness)}，亮度 ${Math.round(summary.medianBrightness)}。${escapeHtml(summary.recommendations.join("；"))}</p>
  <h2>数据提示</h2>
  <ul>${buildDataInsights(summary).map(([label, message]) => `<li><strong>${escapeHtml(label)}：</strong>${escapeHtml(message)}</li>`).join("")}</ul>
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
    if (Number(payload.project_version || 1) > 2) {
      throw new Error("项目文件来自更高版本的剪球，请先更新本地程序");
    }
    if (
      !Array.isArray(payload.events) ||
      !Array.isArray(payload.segments) ||
      !Array.isArray(payload.trajectory)
    ) {
      throw new Error("缺少事件、片段或轨迹数据");
    }
    if (
      payload.events.length > 5000 ||
      payload.segments.length > 5000 ||
      payload.trajectory.length > 200000
    ) {
      throw new Error("项目数据量超过本地编辑器安全限制");
    }
    if (payload.duration && Math.abs(payload.duration - state.duration) > 2) {
      throw new Error("项目时长与当前视频不匹配");
    }
    const fingerprint = payload.source_fingerprint;
    if (fingerprint?.duration && Math.abs(fingerprint.duration - state.duration) > 1) {
      throw new Error("项目指纹时长与当前视频不匹配");
    }
    if (fingerprint?.size) {
      const sizeTolerance = Math.max(1024 * 1024, fingerprint.size * 0.01);
      if (Math.abs(fingerprint.size - state.file.size) > sizeTolerance) {
        throw new Error("项目文件大小与当前视频不匹配，可能选错了原视频");
      }
    }
    const validNormalizedPoint = (point) =>
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= 1 &&
      point.y >= 0 &&
      point.y <= 1;
    const validActivityRegion = (region) =>
      region == null ||
      (
        Number.isFinite(region.x) &&
        Number.isFinite(region.y) &&
        Number.isFinite(region.w) &&
        Number.isFinite(region.h) &&
        region.x >= 0 &&
        region.y >= 0 &&
        region.w >= 0 &&
        region.h >= 0 &&
        region.x + region.w <= 1.02 &&
        region.y + region.h <= 1.02
      );
    const validEvent = (event) =>
      Number.isFinite(event.timestamp) &&
      event.timestamp >= 0 &&
      event.timestamp <= state.duration + 1 &&
      Number.isFinite(event.confidence) &&
      event.confidence >= 0 &&
      event.confidence <= 1 &&
      (event.position == null || validNormalizedPoint(event.position)) &&
      validActivityRegion(event.activityRegion);
    const validSegment = (segment) =>
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.start >= 0 &&
      segment.end >= segment.start &&
      segment.end <= state.duration + 1 &&
      ["keep", "remove"].includes(segment.type);
    const validPoint = (point) =>
      Number.isFinite(point.time) &&
      Number.isFinite(point.xNorm) &&
      Number.isFinite(point.yNorm) &&
      point.time >= 0 &&
      point.time <= state.duration + 1 &&
      point.xNorm >= 0 &&
      point.xNorm <= 1 &&
      point.yNorm >= 0 &&
      point.yNorm <= 1;
    if (!payload.events.every(validEvent)) throw new Error("事件数据超出允许范围");
    if (!payload.segments.every(validSegment)) throw new Error("片段数据超出允许范围");
    if (!payload.trajectory.every(validPoint)) throw new Error("轨迹数据超出允许范围");
    state.events = payload.events.map((event) => ({
      ...event,
      id: String(event.id || `imported_${event.timestamp}`),
      label: String(event.label || "导入击球").slice(0, 80),
      note: String(event.note || "").slice(0, 80),
      reviewStatus: event.reviewStatus || "unreviewed",
      source: event.source || "opencv",
      favorite: Boolean(event.favorite)
    }));
    state.segments = payload.segments.map((segment) => ({
      ...segment,
      id: String(segment.id || `imported_segment_${segment.start}`),
      reason: String(segment.reason || "导入片段").slice(0, 100),
      restored: Boolean(segment.restored)
    }));
    state.trajectory = payload.trajectory;
    state.analysisSource = payload.source || null;
    state.analysisCapabilities = payload.capabilities || null;
    state.excludedExportKeys = new Set(
      Array.isArray(payload.excluded_export_segments)
        ? payload.excluded_export_segments.slice(0, 500).map(String)
        : []
    );
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
      $("analysisPreset").value,
      $("cameraAngle").value
    );
    rebuildHighlights();
    initializeEditHistory();
    writeAnalysisCache(state.currentCacheKey, {
      duration: state.duration,
      events: state.events,
      segments: state.segments,
      highlights: state.highlights,
      trajectory: state.trajectory,
      source: state.analysisSource,
      capabilities: state.analysisCapabilities,
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
      `恢复 ${state.events.length} 个事件、${state.segments.length} 个片段和 ${state.trajectory.length} 个轨迹点。`,
      payload.source_file && payload.source_file !== state.file.name
        ? `提示：项目原文件名为 ${String(payload.source_file).slice(0, 100)}，当前文件名不同，但时长与大小校验已通过。`
        : "原视频指纹校验通过。"
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

function waitForLoadedMetadata(targetVideo) {
  if (targetVideo.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      targetVideo.removeEventListener("loadedmetadata", loaded);
      targetVideo.removeEventListener("error", failed);
    };
    const loaded = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("无法读取视频关键帧"));
    };
    targetVideo.addEventListener("loadedmetadata", loaded);
    targetVideo.addEventListener("error", failed);
  });
}

function getBestHighlight() {
  return state.highlights.slice().sort((a, b) => b.score - a.score)[0] || null;
}

function locateBestHighlight() {
  const highlight = getBestHighlight();
  if (!highlight) return;
  const event = state.events.find((candidate) => candidate.id === highlight.eventId);
  if (event) {
    setReviewLoop(event);
    centerTimelineOn(event.timestamp);
  }
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
  outputContext.textAlign = "right";
  outputContext.fillText(getBrandLabel().slice(0, 18), 1210, 64);
  outputContext.textAlign = "left";

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

async function downloadContactSheet() {
  const events = getActiveEvents().slice().sort((a, b) => a.timestamp - b.timestamp).slice(0, 12);
  if (!state.file || !events.length) {
    setLog(["没有可生成拼图的有效击球。", "请先完成分析并确认需要保留的候选。"]);
    return;
  }
  const button = $("downloadContactSheetBtn");
  button.disabled = true;
  const reviewVideo = document.createElement("video");
  reviewVideo.src = state.url;
  reviewVideo.muted = true;
  reviewVideo.preload = "auto";
  try {
    await waitForLoadedMetadata(reviewVideo);
    const columns = 3;
    const tileWidth = 392;
    const tileHeight = 248;
    const gap = 16;
    const margin = 24;
    const headerHeight = 72;
    const rows = Math.ceil(events.length / columns);
    const output = document.createElement("canvas");
    output.width = margin * 2 + columns * tileWidth + (columns - 1) * gap;
    output.height = headerHeight + margin + rows * tileHeight + (rows - 1) * gap + margin;
    const outputContext = output.getContext("2d");
    outputContext.fillStyle = "#0d1115";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.fillStyle = "#f4f7f8";
    outputContext.font = '700 28px "Microsoft YaHei", sans-serif';
    outputContext.fillText(`${getBrandLabel().slice(0, 18)} · ${sportProfiles[$("sportSelect").value].name}击球复盘`, margin, 38);
    outputContext.fillStyle = "#91a0ad";
    outputContext.font = '14px "Microsoft YaHei", sans-serif';
    outputContext.fillText(`${state.file.name} · ${events.length} 个有效候选`, margin, 62);

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      await waitForSeek(reviewVideo, clamp(event.timestamp, 0, state.duration));
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * (tileWidth + gap);
      const y = headerHeight + row * (tileHeight + gap);
      const imageHeight = 190;
      outputContext.fillStyle = "#050607";
      outputContext.fillRect(x, y, tileWidth, tileHeight);
      const render = getContainedRect(
        tileWidth,
        imageHeight,
        reviewVideo.videoWidth,
        reviewVideo.videoHeight
      );
      outputContext.drawImage(
        reviewVideo,
        x + render.x,
        y + render.y,
        render.width,
        render.height
      );
      if (event.position) {
        const markerX = x + render.x + render.width * event.position.x;
        const markerY = y + render.y + render.height * event.position.y;
        outputContext.strokeStyle = "#f6c85f";
        outputContext.lineWidth = 4;
        outputContext.beginPath();
        outputContext.arc(markerX, markerY, 13, 0, Math.PI * 2);
        outputContext.stroke();
      }
      outputContext.fillStyle = "#f4f7f8";
      outputContext.font = '700 15px "Microsoft YaHei", sans-serif';
      outputContext.fillText(
        `${String(index + 1).padStart(2, "0")}  ${formatTime(event.timestamp)}  ${getShotTypeLabel(event.shotType)}`,
        x + 12,
        y + 216
      );
      outputContext.fillStyle = "#91a0ad";
      outputContext.font = '12px "Microsoft YaHei", sans-serif';
      const status = event.reviewStatus === "confirmed"
        ? "已确认"
        : event.source === "manual"
          ? "手动添加"
          : "待确认";
      outputContext.fillText(
        `置信度 ${Math.round(event.confidence * 100)}% · ${status}`,
        x + 12,
        y + 238
      );
      showAnalysisProgress({
        phase: `正在提取击球关键帧 ${index + 1} / ${events.length}`,
        percent: (index + 1) / events.length,
        eta: formatRemaining(Math.max(0, events.length - index - 1) * 0.25),
        speed: `${Math.round(((index + 1) / events.length) * 100)}%`
      });
    }

    const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("浏览器无法生成 PNG");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `jianqiu-contact-sheet-${Date.now()}.png`;
    link.click();
    URL.revokeObjectURL(url);
    setLog(["击球复盘拼图已生成。", `按时间顺序汇总 ${events.length} 个关键帧，图片只在本机生成。`]);
  } catch (error) {
    setLog(["击球复盘拼图生成失败。", error.message || "无法读取视频关键帧。"]);
  } finally {
    hideAnalysisProgress();
    reviewVideo.removeAttribute("src");
    reviewVideo.load();
    button.disabled = false;
  }
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

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadTrainingCsv() {
  if (!state.analysisQuality) return;
  const header = [
    "时间秒",
    "时间码",
    "动作类型",
    "标签",
    "置信度",
    "精彩分",
    "确认状态",
    "收藏",
    "方向变化度",
    "击球后画面球速px/s",
    "轨迹连续度",
    "备注"
  ];
  const activeEvents = getActiveEvents();
  const rows = state.events.map((event) => [
    event.timestamp.toFixed(3),
    formatTime(event.timestamp),
    getShotTypeLabel(event.shotType),
    event.label,
    Math.round(event.confidence * 100),
    Math.round(getHighlightScore(event, activeEvents) * 100),
    event.reviewStatus,
    event.favorite ? "是" : "否",
    event.evidence?.directionChangeDegrees ?? "",
    event.evidence?.speedAfterPxPerSec ?? "",
    event.evidence?.trackContinuity ?? "",
    event.note || ""
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  downloadText(
    `jianqiu-training-events-${Date.now()}.csv`,
    `\ufeff${csv}`,
    "text/csv;charset=utf-8"
  );
}

function downloadAnnotations() {
  if (!state.analysisQuality || !state.file) return;
  const payload = buildAnnotationPayload({
    fileName: state.file.name,
    fileSize: state.file.size,
    duration: state.duration,
    sport: $("sportSelect").value,
    cameraAngle: $("cameraAngle").value,
    events: state.events
  });
  downloadText(
    `jianqiu-annotations-${Date.now()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
  const review = buildCandidateReviewMetrics(state.events);
  setLog([
    "标注数据已下载。",
    `包含 ${payload.annotations.length} 条事件：确认 ${review.confirmed}、误报 ${review.ignored}、待复核 ${review.remaining}；不包含原视频。`
  ]);
}

function downloadEditDecisionList() {
  if (!state.file || !state.duration) return;
  const segments = getExportSegments();
  if (!segments.length) {
    setLog(["没有可写入 EDL 的保留片段。", "请调整剪辑目标或恢复需要保留的片段。"]);
    return;
  }
  const title = state.file.name.replace(/\.[^.]+$/, "").slice(0, 80);
  const edl = buildEdl({
    title,
    fileName: state.file.name,
    segments,
    measuredFrameRate: state.analysisSource?.fps
  });
  downloadText(
    `jianqiu-${Date.now()}.edl`,
    edl.text,
    "text/plain;charset=utf-8"
  );
  setLog([
    "EDL 剪辑清单已下载。",
    `共 ${segments.length} 段，按 ${edl.frameRate}fps 非丢帧时间码生成，可导入专业剪辑软件继续精修。`
  ]);
}

async function exportPreview() {
  if (!state.file || !state.duration || state.exporting) return;
  state.exporting = true;
  $("exportBtn").disabled = true;
  const kept = getExportSegments().slice(0, 12);
  if (!kept.length) {
    setLog(["没有可导出的片段。", "请确认或收藏击球候选，或切换到其他剪辑目标。"]);
    state.exporting = false;
    $("exportBtn").disabled = false;
    return;
  }
  try {
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
  const exportStartedAt = performance.now();
  const reframeState = { x: 0.5, y: 0.5 };
  setLog([
    "正在导出带水印预览。",
    `预计约 ${formatRemaining(totalExportSeconds).replace("预计剩余 ", "")}，${audioIncluded ? "已保留原声音轨" : "当前浏览器将导出静音视频"}。`,
    $("smartReframe").checked && ratio !== "source"
      ? "已启用球轨迹智能跟拍裁切。"
      : "使用固定画幅导出。"
  ]);
  recorder.start();

  let completedSourceSeconds = 0;
  for (const segment of kept) {
    await waitForSeek(exportVideo, segment.start);
    await exportVideo.play();
    await drawExportSegment(exportVideo, outCtx, out, segment.start, segment.end, reframeState, (segmentProgress) => {
      const currentSourceSeconds =
        completedSourceSeconds + (segment.end - segment.start) * segmentProgress;
      const progress = clamp(currentSourceSeconds / totalExportSeconds, 0, 1);
      const elapsed = (performance.now() - exportStartedAt) / 1000;
      const eta = progress > 0.02 ? elapsed * (1 - progress) / progress : null;
      showAnalysisProgress({
        phase: `正在导出片段 ${kept.indexOf(segment) + 1} / ${kept.length}`,
        percent: progress,
        eta: formatRemaining(eta),
        speed: `${Math.round(progress * 100)}%`
      });
    });
    completedSourceSeconds += segment.end - segment.start;
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
  } catch (error) {
    setLog(["导出失败。", error.message || "当前浏览器无法完成本地录制。"]);
  } finally {
    hideAnalysisProgress();
    state.exporting = false;
    $("exportBtn").disabled = false;
  }
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

function getTrackingFocus(time) {
  const nearbyTrajectory = state.trajectory.filter((point) => Math.abs(point.time - time) <= 0.75);
  if (nearbyTrajectory.length) {
    const weighted = nearbyTrajectory.reduce((result, point) => {
      const weight = 1 - Math.min(0.9, Math.abs(point.time - time) / 0.85);
      result.x += point.xNorm * weight;
      result.y += point.yNorm * weight;
      result.weight += weight;
      return result;
    }, { x: 0, y: 0, weight: 0 });
    return {
      x: weighted.x / weighted.weight,
      y: weighted.y / weighted.weight
    };
  }
  const nearestEvent = getActiveEvents()
    .filter((event) => event.position && Math.abs(event.timestamp - time) <= 3)
    .sort((a, b) => Math.abs(a.timestamp - time) - Math.abs(b.timestamp - time))[0];
  return nearestEvent?.position || { x: 0.5, y: 0.5 };
}

function getExportRenderRect(exportVideo, out, time, reframeState) {
  const sourceWidth = exportVideo.videoWidth;
  const sourceHeight = exportVideo.videoHeight;
  const shouldCrop = $("smartReframe").checked && $("ratioSelect").value !== "source";
  if (!shouldCrop) {
    const scale = Math.min(out.width / sourceWidth, out.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: (out.width - width) / 2,
      dy: (out.height - height) / 2,
      dw: width,
      dh: height
    };
  }

  const focus = getTrackingFocus(time);
  reframeState.x += (focus.x - reframeState.x) * 0.075;
  reframeState.y += (focus.y - reframeState.y) * 0.075;
  const outputAspect = out.width / out.height;
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > outputAspect) {
    const cropWidth = sourceHeight * outputAspect;
    return {
      sx: clamp(reframeState.x * sourceWidth - cropWidth / 2, 0, sourceWidth - cropWidth),
      sy: 0,
      sw: cropWidth,
      sh: sourceHeight,
      dx: 0,
      dy: 0,
      dw: out.width,
      dh: out.height
    };
  }
  const cropHeight = sourceWidth / outputAspect;
  return {
    sx: 0,
    sy: clamp(reframeState.y * sourceHeight - cropHeight / 2, 0, sourceHeight - cropHeight),
    sw: sourceWidth,
    sh: cropHeight,
    dx: 0,
    dy: 0,
    dw: out.width,
    dh: out.height
  };
}

function mapExportPoint(point, render, exportVideo, out) {
  return {
    x: render.dx + ((point.x * exportVideo.videoWidth - render.sx) / render.sw) * render.dw,
    y: render.dy + ((point.y * exportVideo.videoHeight - render.sy) / render.sh) * render.dh
  };
}

function mergeExportSegments(segments) {
  return mergeSegments(segments);
}

function exportSegmentKey(segment) {
  return `${Number(segment.start).toFixed(3)}-${Number(segment.end).toFixed(3)}`;
}

function getRawExportSegments() {
  if ($("modeSelect").value === "highlights") {
    const threshold = getHighlightThreshold();
    const candidates = [
      ...buildRallies().filter((rally) => rally.hitCount >= 2 && rally.score >= threshold),
      ...state.highlights
        .filter((highlight) => highlight.favorite || highlight.score >= threshold)
        .map((highlight) => ({
          ...highlight,
          timestamp: state.events.find((event) => event.id === highlight.eventId)?.timestamp
        }))
    ];
    return selectByDuration(candidates, Number($("highlightDuration").value));
  }
  return getKeptSegments();
}

function getExportSegments() {
  return getRawExportSegments().filter((segment) =>
    !state.excludedExportKeys.has(exportSegmentKey(segment))
  );
}

function getRecorderOptions(candidates) {
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  return mimeType ? { mimeType } : undefined;
}

function drawExportSegment(exportVideo, outCtx, out, start, end, reframeState, onProgress) {
  return new Promise((resolve) => {
    const profile = sportProfiles[$("sportSelect").value];
    const settings = getEffectSettings(profile);
    const draw = () => {
      if (exportVideo.currentTime >= end || exportVideo.ended) {
        exportVideo.playbackRate = 1;
        onProgress?.(1);
        resolve();
        return;
      }
      onProgress?.(clamp((exportVideo.currentTime - start) / Math.max(0.01, end - start), 0, 1));

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
      const render = getExportRenderRect(exportVideo, out, exportVideo.currentTime, reframeState);
      outCtx.drawImage(
        exportVideo,
        render.sx,
        render.sy,
        render.sw,
        render.sh,
        render.dx,
        render.dy,
        render.dw,
        render.dh
      );

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
          const mapped = mapExportPoint(
            { x: point.xNorm, y: point.yNorm },
            render,
            exportVideo,
            out
          );
          if (index === 0) outCtx.moveTo(mapped.x, mapped.y);
          else outCtx.lineTo(mapped.x, mapped.y);
        });
        outCtx.stroke();
        outCtx.restore();
      }

      if ($("showImpact").checked) state.events
        .filter((event) => Math.abs(event.timestamp - exportVideo.currentTime) < 0.6)
        .forEach((event) => {
          const pulse = 1 - Math.abs(event.timestamp - exportVideo.currentTime) / 0.6;
          if (!event.position) return;
          const mapped = mapExportPoint(event.position, render, exportVideo, out);
          outCtx.save();
          outCtx.globalAlpha = pulse;
          outCtx.strokeStyle = settings.color;
          outCtx.lineWidth = settings.lineWidth * 1.5;
          outCtx.shadowColor = settings.color;
          outCtx.shadowBlur = settings.glow;
          outCtx.beginPath();
          outCtx.arc(mapped.x, mapped.y, settings.radius + 70 * (1 - pulse), 0, Math.PI * 2);
          outCtx.stroke();
          outCtx.restore();
        });

      if ($("showActivityRegion").checked) state.events
        .filter((event) => event.activityRegion && Math.abs(event.timestamp - exportVideo.currentTime) < 0.6)
        .forEach((event) => {
          const topLeft = mapExportPoint(
            { x: event.activityRegion.x, y: event.activityRegion.y },
            render,
            exportVideo,
            out
          );
          const bottomRight = mapExportPoint(
            {
              x: event.activityRegion.x + event.activityRegion.w,
              y: event.activityRegion.y + event.activityRegion.h
            },
            render,
            exportVideo,
            out
          );
          outCtx.save();
          outCtx.strokeStyle = "rgba(76,201,164,0.9)";
          outCtx.fillStyle = "rgba(76,201,164,0.12)";
          outCtx.lineWidth = 3;
          outCtx.setLineDash([10, 8]);
          outCtx.fillRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
          );
          outCtx.strokeRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
          );
          outCtx.restore();
        });

      outCtx.font = "700 24px sans-serif";
      const brandLabel = getBrandLabel().slice(0, 18);
      const brandWidth = Math.min(out.width - 48, Math.max(204, outCtx.measureText(brandLabel).width + 32));
      outCtx.fillStyle = "rgba(0,0,0,.48)";
      outCtx.fillRect(out.width - brandWidth - 32, 22, brandWidth, 42);
      outCtx.fillStyle = "rgba(255,255,255,.86)";
      outCtx.fillText(brandLabel, out.width - brandWidth - 16, 51);
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
  renderVideoPreflight();
  const preset = $("analysisPreset").value;
  setLog([
    "已读取视频信息。",
    `原片时长 ${formatTime(state.duration)}，${preset === "standard" ? "标准" : preset === "fast" ? "快速" : "精细"}分析预计约 ${formatRemaining(getEstimatedAnalysisSeconds(state.duration, preset)).replace("预计剩余 ", "")}。`
  ]);
});
$("analysisPreset").addEventListener("change", () => {
  if (!state.duration) return;
  renderVideoPreflight();
  const preset = $("analysisPreset").value;
  setLog([
    `已切换到${preset === "standard" ? "标准" : preset === "fast" ? "快速预筛" : "精细追踪"}。`,
    `按本机历史速度，预计约 ${formatRemaining(getEstimatedAnalysisSeconds(state.duration, preset)).replace("预计剩余 ", "")}。`
  ]);
});
$("cameraAngle").addEventListener("change", () => {
  const angle = $("cameraAngle").value;
  if (angle === "sideline" || angle === "handheld") {
    setLog([
      angle === "sideline" ? "已选择边线广角机位。" : "已选择手持跟拍机位。",
      "该模式会扩大镜头与击球区域容忍，可能生成更多候选，请在导出前完成复核。"
    ]);
  }
});
$("modeSelect").addEventListener("change", () => {
  $("highlightDuration").disabled = $("modeSelect").value !== "highlights";
  renderAll();
});
$("highlightDuration").addEventListener("change", renderAll);
$("autoSlowMotion").addEventListener("change", renderAll);
$("highlightDuration").disabled = $("modeSelect").value !== "highlights";
$("ratioSelect").addEventListener("change", () => {
  state.previewReframe = { x: 0.5, y: 0.5 };
  drawEffects();
});
$("smartReframe").addEventListener("change", () => {
  state.previewReframe = { x: 0.5, y: 0.5 };
  drawEffects();
});
$("creatorName").addEventListener("input", updateBrandUi);
$("reviewPlaybackRate").addEventListener("change", updatePreviewPlaybackRate);
$("loopReview").addEventListener("change", () => {
  if (!$("loopReview").checked) state.reviewLoop = null;
});
video.addEventListener("timeupdate", () => {
  skipRemovedSegments();
  updateReviewLoop();
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
  drawEffects();
});

$("analyzeBtn").addEventListener("click", generateAnalysis);
$("cancelAnalyzeBtn").addEventListener("click", cancelAnalysis);
$("addHitBtn").addEventListener("click", addHitAtCurrentTime);
$("confirmHighBtn").addEventListener("click", confirmHighConfidenceEvents);
$("nextUnreviewedBtn").addEventListener("click", navigateNextUnreviewed);
$("confirmNextBtn").addEventListener("click", confirmCurrentAndContinue);
$("undoEditBtn").addEventListener("click", undoEdit);
$("redoEditBtn").addEventListener("click", redoEdit);
$("markCutStartBtn").addEventListener("click", markCutStart);
$("finishCutBtn").addEventListener("click", finishManualCut);
$("eventFilter").addEventListener("change", renderEvents);
$("highlightThreshold").addEventListener("input", () => {
  $("highlightThresholdValue").textContent = `${$("highlightThreshold").value} 分`;
  renderAll();
});
$("previousEventBtn").addEventListener("click", () => navigateEvent(-1));
$("nextEventBtn").addEventListener("click", () => navigateEvent(1));
$("previousFrameBtn").addEventListener("click", () => stepVideoFrame(-1));
$("nextFrameBtn").addEventListener("click", () => stepVideoFrame(1));
$("calibrateBallBtn").addEventListener("click", startBallColorCalibration);
$("resetBallColorBtn").addEventListener("click", resetBallColor);
document.querySelector(".player-frame").addEventListener("click", handlePlayerFrameClick);
$("demoBtn").addEventListener("click", createDemoVideo);
$("importProjectBtn").addEventListener("click", () => $("projectInput").click());
$("projectInput").addEventListener("change", (event) => importProjectFile(event.target.files[0]));
$("clearLocalDataBtn").addEventListener("click", clearLocalAnalysisData);
$("retryEnvironmentBtn").addEventListener("click", () => checkLocalAnalyzerEnvironment(true));
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
$("downloadContactSheetBtn").addEventListener("click", downloadContactSheet);
$("copyCaptionBtn").addEventListener("click", copySocialCaption);
$("downloadCsvBtn").addEventListener("click", downloadTrainingCsv);
$("downloadAnnotationsBtn").addEventListener("click", downloadAnnotations);
$("downloadEdlBtn").addEventListener("click", downloadEditDecisionList);
$("shotMap").addEventListener("click", locateShotMapEvent);
$("historyBaselineSelect").addEventListener("change", (event) => {
  state.selectedHistoryKey = event.target.value;
  renderTrainingHistory();
});
$("exportBtn").addEventListener("click", exportPreview);
$("timeline").addEventListener("click", (event) => {
  if (!state.duration) return;
  state.reviewLoop = null;
  const rect = $("timeline").getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const viewport = getTimelineViewport();
  video.currentTime = viewport.start + ratio * (viewport.end - viewport.start);
  updatePlaybackProgress();
});
$("timelineZoom").addEventListener("change", () => {
  centerTimelineOn(video.currentTime);
  renderTimeline();
  updatePlaybackProgress();
  saveEditorPreferences();
});
window.addEventListener("resize", sizeCanvasToVideo);
window.addEventListener("keydown", handleEditorShortcut);
preferenceControlIds.forEach((id) => {
  $(id)?.addEventListener("change", saveEditorPreferences);
});

loadEditorPreferences();
updateBrandUi();
renderAll();
checkLocalAnalyzerEnvironment();
resumeActiveAnalysis();
