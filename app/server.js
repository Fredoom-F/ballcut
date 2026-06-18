const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const root = __dirname;
const projectRoot = path.resolve(root, "..");
const port = Number(process.env.PORT || 4173);
const maxUploadBytes = 1024 * 1024 * 1024;
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
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.resolve(root, cleanPath === "/" ? "index.html" : cleanPath.slice(1));
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? target : null;
}

const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify({ status: "ok", service: "jianqiu", port }));
      return;
    }

    if (req.url?.startsWith("/api/analyze") && req.method === "POST") {
      analyzeRequest(req, res);
      return;
    }

    const target = safePath(req.url || "/");
    if (!target) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(target)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
      });
      res.end(data);
    });
  });

function analyzeRequest(req, res) {
  const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const sport = requestUrl.searchParams.get("sport") || "tennis";
  const strength = Math.max(1, Math.min(3, Number(requestUrl.searchParams.get("strength") || 2)));
  const allowedSports = new Set(["tennis", "badminton", "tabletennis", "basketball", "football", "golf"]);
  if (!allowedSports.has(sport)) {
    sendJson(res, 400, { error: "不支持的运动类型" });
    return;
  }

  const requestId = crypto.randomBytes(12).toString("hex");
  const tempPath = path.join(os.tmpdir(), `jianqiu-${requestId}.video`);
  const output = fs.createWriteStream(tempPath, { flags: "wx" });
  let received = 0;
  let aborted = false;

  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxUploadBytes) {
      aborted = true;
      req.destroy();
      output.destroy();
      fs.rm(tempPath, { force: true }, () => {});
      sendJson(res, 413, { error: "视频超过 1GB 本地分析限制" });
      return;
    }
    output.write(chunk);
  });

  req.on("end", () => {
    if (aborted) return;
    output.end(async () => {
      try {
        const result = await runAnalyzer(tempPath, sport, strength);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, { error: error.message || "本地分析失败" });
      } finally {
        fs.rm(tempPath, { force: true }, () => {});
      }
    });
  });

  req.on("error", () => {
    output.destroy();
    fs.rm(tempPath, { force: true }, () => {});
  });
}

function runAnalyzer(videoPath, sport, strength) {
  return new Promise((resolve, reject) => {
    const script = path.join(projectRoot, "analyzer", "analyze_video.py");
    const child = spawn(
      "python",
      [script, videoPath, "--sport", sport, "--strength", String(strength)],
      {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => reject(new Error(`无法启动 OpenCV 分析器：${error.message}`)));
    child.on("close", (code) => {
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
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
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

server.listen(port, "127.0.0.1", () => {
  console.log(`剪球本地版已启动：http://127.0.0.1:${port}/`);
  console.log("请保持此窗口开启。关闭窗口会停止本地服务。");
});
