const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const root = __dirname;
const projectRoot = path.resolve(root, "..");
const port = Number(process.env.PORT || 4173);
const serviceVersion = "0.4.4";
const maxUploadBytes = 1024 * 1024 * 1024;
const maxConcurrentJobs = 2;
const maxConcurrentUploads = 2;
const jobs = new Map();
let activeUploads = 0;
const analyzerEnvironment = inspectAnalyzerEnvironment();
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".mp4": "video/mp4"
};

function safePath(urlPath) {
  try {
    const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
    const target = path.resolve(root, cleanPath === "/" ? "index.html" : cleanPath.slice(1));
    const relative = path.relative(root, target);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (requestUrl.pathname.startsWith("/api/") && !isTrustedLocalRequest(req)) {
      sendJson(res, 403, { error: "拒绝来自其他网页的本地分析请求" });
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...securityHeaders()
      });
      res.end(JSON.stringify({
        status: "ok",
        service: "jianqiu",
        version: serviceVersion,
        port,
        analyzerReady: analyzerEnvironment.ready
      }));
      return;
    }

    if (requestUrl.pathname === "/api/system" && req.method === "GET") {
      sendJson(res, 200, { ...analyzerEnvironment, serviceVersion });
      return;
    }

    if (requestUrl.pathname === "/api/analyze/start" && req.method === "POST") {
      startAnalyzeJob(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/api/analyze/status" && req.method === "GET") {
      getAnalyzeJobStatus(res, requestUrl.searchParams.get("id"));
      return;
    }

    if (requestUrl.pathname === "/api/analyze/result" && req.method === "GET") {
      getAnalyzeJobResult(res, requestUrl.searchParams.get("id"));
      return;
    }

    if (requestUrl.pathname === "/api/analyze/cancel" && req.method === "DELETE") {
      cancelAnalyzeJob(res, requestUrl.searchParams.get("id"));
      return;
    }

    if (requestUrl.pathname === "/api/analyze" && req.method === "POST") {
      analyzeRequest(req, res);
      return;
    }

    const target = safePath(req.url || "/");
    if (!target) {
      res.writeHead(403, securityHeaders());
      res.end("Forbidden");
      return;
    }

    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404, securityHeaders());
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(target)] || "application/octet-stream",
        "Cache-Control": "no-store",
        ...securityHeaders()
      });
      res.end(data);
    });
  });

function validateAnalyzeOptions(requestUrl) {
  const sport = requestUrl.searchParams.get("sport") || "tennis";
  const strength = Math.max(1, Math.min(3, Number(requestUrl.searchParams.get("strength") || 2)));
  const sensitivity = Math.max(1, Math.min(3, Number(requestUrl.searchParams.get("sensitivity") || 2)));
  const preset = requestUrl.searchParams.get("preset") || "standard";
  const cameraAngle = requestUrl.searchParams.get("cameraAngle") || "auto";
  const ballValue = requestUrl.searchParams.get("ball");
  const allowedSports = new Set(["tennis", "badminton", "tabletennis", "basketball", "football", "golf"]);
  if (!allowedSports.has(sport)) return null;
  if (!new Set(["fast", "standard", "precise"]).has(preset)) return null;
  if (!new Set(["auto", "baseline", "sideline", "handheld"]).has(cameraAngle)) return null;
  let ballColor = null;
  if (ballValue) {
    const channels = ballValue.split(",").map(Number);
    if (channels.length !== 3 || channels.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      return null;
    }
    ballColor = channels;
  }
  return { sport, strength, sensitivity, preset, cameraAngle, ballColor };
}

function inspectAnalyzerEnvironment() {
  const check = spawnSync(
    "python",
    [
      "-c",
      "import json,sys,cv2,numpy; print(json.dumps({'python':sys.version.split()[0],'opencv':cv2.__version__,'numpy':numpy.__version__}))"
    ],
    {
      cwd: projectRoot,
      windowsHide: true,
      encoding: "utf8",
      timeout: 10000
    }
  );
  if (check.status === 0) {
    try {
      return { ready: true, ...JSON.parse(check.stdout.trim()) };
    } catch {
      return { ready: false, error: "无法读取 OpenCV 环境版本" };
    }
  }
  return {
    ready: false,
    error: (check.stderr || check.error?.message || "Python/OpenCV 环境不可用").trim(),
    installCommand: "python -m pip install opencv-python numpy"
  };
}

function isTrustedLocalRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' blob: data:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join("; ")
  };
}

function validateUploadRequest(req, res) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/octet-stream")) {
    sendJson(res, 415, { error: "分析接口只接受视频二进制数据" });
    return false;
  }
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > maxUploadBytes) {
    sendJson(res, 413, { error: "视频超过 1GB 本地分析限制" });
    return false;
  }
  return true;
}

function startAnalyzeJob(req, res, requestUrl) {
  if (!analyzerEnvironment.ready) {
    sendJson(res, 503, {
      error: "本地 OpenCV 环境不可用",
      installCommand: analyzerEnvironment.installCommand
    });
    return;
  }
  if (!validateUploadRequest(req, res)) return;
  const activeJobs = [...jobs.values()].filter((job) =>
    ["analyzing", "finalizing"].includes(job.status)
  ).length;
  if (activeJobs >= maxConcurrentJobs) {
    sendJson(res, 429, { error: "已有多个分析任务正在运行，请稍后再试" });
    return;
  }
  const options = validateAnalyzeOptions(requestUrl);
  if (!options) {
    sendJson(res, 400, { error: "不支持的分析参数" });
    return;
  }

  receiveUpload(req, res, (tempPath, received) => {
    const id = crypto.randomBytes(12).toString("hex");
    const job = {
      id,
      status: "analyzing",
      phase: "analyzing",
      progress: 0,
      etaSeconds: null,
      processingFps: 0,
      processedSeconds: 0,
      totalSeconds: null,
      uploadBytes: received,
      fileName: decodeHeaderValue(req.headers["x-jianqiu-file-name"]),
      cacheKey: decodeHeaderValue(req.headers["x-jianqiu-cache-key"]),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tempPath,
      result: null,
      error: null,
      child: null
    };
    jobs.set(id, job);
    const analyzer = runAnalyzer(
      tempPath,
      options.sport,
      options.strength,
      options.sensitivity,
      options.preset,
      options.cameraAngle,
      options.ballColor,
      (progress) => {
      Object.assign(job, progress, {
        status: progress.phase === "finalizing" ? "finalizing" : "analyzing",
        updatedAt: Date.now()
      });
      },
      true
    );
    job.child = analyzer.child;

    analyzer.promise
      .then((result) => {
        job.status = "completed";
        job.phase = "completed";
        job.progress = 1;
        job.etaSeconds = 0;
        job.result = result;
        job.updatedAt = Date.now();
      })
      .catch((error) => {
        if (job.status !== "cancelled") {
          job.status = "failed";
          job.phase = "failed";
          job.error = error.message || "本地分析失败";
          job.updatedAt = Date.now();
        }
      })
      .finally(() => {
        job.child = null;
        fs.rm(tempPath, { force: true }, () => {});
        setTimeout(() => jobs.delete(id), 60 * 60 * 1000).unref();
      });

    sendJson(res, 202, { id, status: job.status });
  });
}

function getAnalyzeJobStatus(res, id) {
  const job = jobs.get(id);
  if (!job) {
    sendJson(res, 404, { error: "分析任务不存在或已过期" });
    return;
  }
  sendJson(res, 200, publicJobState(job));
}

function getAnalyzeJobResult(res, id) {
  const job = jobs.get(id);
  if (!job) {
    sendJson(res, 404, { error: "分析任务不存在或已过期" });
    return;
  }
  if (job.status !== "completed") {
    sendJson(res, 409, { error: "分析尚未完成", ...publicJobState(job) });
    return;
  }
  sendJson(res, 200, job.result);
}

function cancelAnalyzeJob(res, id) {
  const job = jobs.get(id);
  if (!job) {
    sendJson(res, 404, { error: "分析任务不存在或已过期" });
    return;
  }
  if (job.child) job.child.kill();
  job.status = "cancelled";
  job.phase = "cancelled";
  job.error = "用户已取消分析";
  job.etaSeconds = 0;
  job.updatedAt = Date.now();
  fs.rm(job.tempPath, { force: true }, () => {});
  sendJson(res, 200, publicJobState(job));
}

function publicJobState(job) {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    etaSeconds: job.etaSeconds,
    processingFps: job.processingFps,
    processedSeconds: job.processedSeconds,
    totalSeconds: job.totalSeconds,
    uploadBytes: job.uploadBytes,
    fileName: job.fileName,
    elapsedSeconds: job.elapsedSeconds || 0,
    error: job.error,
    updatedAt: job.updatedAt
  };
}

function decodeHeaderValue(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(String(value));
  } catch {
    return "";
  }
}

function receiveUpload(req, res, onComplete) {
  if (activeUploads >= maxConcurrentUploads) {
    sendJson(res, 429, { error: "已有多个视频正在上传，请稍后再试" });
    req.resume();
    return;
  }
  activeUploads += 1;
  const requestId = crypto.randomBytes(12).toString("hex");
  const originalName = decodeHeaderValue(req.headers["x-jianqiu-file-name"]);
  const requestedExtension = path.extname(originalName).toLowerCase();
  const allowedExtensions = new Set([".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"]);
  const extension = allowedExtensions.has(requestedExtension) ? requestedExtension : ".video";
  const tempPath = path.join(os.tmpdir(), `jianqiu-${requestId}${extension}`);
  const output = fs.createWriteStream(tempPath, { flags: "wx" });
  let received = 0;
  let aborted = false;
  let released = false;

  function releaseUpload() {
    if (released) return;
    released = true;
    activeUploads = Math.max(0, activeUploads - 1);
  }

  function cleanup() {
    releaseUpload();
    output.destroy();
    fs.rm(tempPath, { force: true }, () => {});
  }

  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxUploadBytes) {
      aborted = true;
      cleanup();
      sendJson(res, 413, { error: "视频超过 1GB 本地分析限制" });
      req.destroy();
      return;
    }
    if (!output.write(chunk)) {
      req.pause();
      output.once("drain", () => req.resume());
    }
  });

  req.on("end", () => {
    if (aborted) return;
    output.once("close", () => {
      if (aborted) return;
      releaseUpload();
      if (!received) {
        fs.rm(tempPath, { force: true }, () => {});
        sendJson(res, 400, { error: "上传的视频为空" });
        return;
      }
      onComplete(tempPath, received);
    });
    output.end();
  });

  req.on("aborted", cleanup);
  req.on("error", cleanup);
  output.on("error", (error) => {
    aborted = true;
    cleanup();
    sendJson(res, 500, { error: `无法保存本地临时视频：${error.message}` });
  });
}

function analyzeRequest(req, res) {
  if (!analyzerEnvironment.ready) {
    sendJson(res, 503, {
      error: "本地 OpenCV 环境不可用",
      installCommand: analyzerEnvironment.installCommand
    });
    return;
  }
  if (!validateUploadRequest(req, res)) return;
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const options = validateAnalyzeOptions(requestUrl);
  if (!options) {
    sendJson(res, 400, { error: "不支持的分析参数" });
    return;
  }

  receiveUpload(req, res, async (tempPath) => {
    try {
      const analyzer = runAnalyzer(
        tempPath,
        options.sport,
        options.strength,
        options.sensitivity,
        options.preset,
        options.cameraAngle,
        options.ballColor
      );
      const result = await analyzer.promise;
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "本地分析失败" });
    } finally {
      fs.rm(tempPath, { force: true }, () => {});
    }
  });
}

function runAnalyzer(videoPath, sport, strength, sensitivity, preset, cameraAngle, ballColor, onProgress, reportProgress = false) {
  const script = path.join(projectRoot, "analyzer", "analyze_video.py");
  const args = [script, videoPath, "--sport", sport, "--strength", String(strength)];
  args.push("--sensitivity", String(sensitivity));
  args.push("--preset", preset);
  args.push("--camera-angle", cameraAngle);
  if (ballColor) args.push("--ball-rgb", ballColor.join(","));
  if (reportProgress) args.push("--progress");
  const child = spawn(
    "python",
    args,
    {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const promise = new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let stderrBuffer = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("JIANQIU_PROGRESS ")) {
          try {
            onProgress?.(JSON.parse(line.slice("JIANQIU_PROGRESS ".length)));
          } catch {
            stderr.push(Buffer.from(line));
          }
        } else if (line.trim()) {
          stderr.push(Buffer.from(line));
        }
      }
    });
    child.on("error", (error) => reject(new Error(`无法启动 OpenCV 分析器：${error.message}`)));
    child.on("close", (code) => {
      if (stderrBuffer.trim()) stderr.push(Buffer.from(stderrBuffer));
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || "OpenCV 分析器异常退出"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch {
        reject(new Error("分析器返回了无效结果"));
      }
    });
  });
  return { promise, child };
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders()
  });
  res.end(JSON.stringify(payload));
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。剪球可能已经启动，请直接打开 http://127.0.0.1:${port}/`);
  } else {
    console.error("剪球服务启动失败：", error.message);
  }
  process.exitCode = 1;
});

server.headersTimeout = 15000;
server.requestTimeout = 15 * 60 * 1000;
server.keepAliveTimeout = 5000;

server.listen(port, "127.0.0.1", () => {
  console.log(`剪球本地版已启动：http://127.0.0.1:${port}/`);
  console.log(`服务版本 ${serviceVersion}，仅监听本机地址。`);
});

for (const file of fs.readdirSync(os.tmpdir())) {
  if (/^jianqiu-[a-f0-9]{24}\.(video|mp4|mov|m4v|avi|webm|mkv)$/i.test(file)) {
    fs.rm(path.join(os.tmpdir(), file), { force: true }, () => {});
  }
}
