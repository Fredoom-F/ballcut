import http.client
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VIDEO = Path(r"C:\Users\19430\Downloads\VID_20260117_185203.mp4")


def wait_for_server(port, timeout=12):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            connection.request("GET", "/health")
            response = connection.getresponse()
            response.read()
            if response.status == 200:
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("real progress test server did not start")


def make_proxy(source, destination, start_seconds=20, duration_seconds=35):
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open {source}")
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30
    capture.set(cv2.CAP_PROP_POS_MSEC, start_seconds * 1000)
    output_fps = 15
    step = max(1, round(source_fps / output_fps))
    writer = cv2.VideoWriter(
        str(destination),
        cv2.VideoWriter_fourcc(*"MJPG"),
        output_fps,
        (640, 360),
    )
    source_frames = round(duration_seconds * source_fps)
    written = 0
    for index in range(source_frames):
        ok, frame = capture.read()
        if not ok:
            break
        if index % step:
            continue
        writer.write(cv2.resize(frame, (640, 360), interpolation=cv2.INTER_AREA))
        written += 1
    writer.release()
    capture.release()
    if written < output_fps * 10:
        raise RuntimeError("proxy video is unexpectedly short")
    return written / output_fps


def run():
    source = Path(os.environ.get("JIANQIU_REAL_VIDEO", DEFAULT_VIDEO))
    if not source.exists():
        print(f"Skipped real progress test; video not found: {source}")
        return

    port = 4184
    with tempfile.TemporaryDirectory(prefix="jianqiu-real-progress-") as temporary:
        proxy = Path(temporary) / "real-tennis-proxy.avi"
        proxy_duration = make_proxy(source, proxy)
        process = subprocess.Popen(
            ["node", "server.js"],
            cwd=ROOT / "app",
            env={**os.environ, "PORT": str(port)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            wait_for_server(port)
            payload = proxy.read_bytes()
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=180)
            connection.request(
                "POST",
                "/api/analyze/start?sport=tennis&strength=2&sensitivity=2&preset=standard",
                body=payload,
                headers={
                    "Content-Type": "application/octet-stream",
                    "Content-Length": str(len(payload)),
                    "X-Jianqiu-File-Name": "real-tennis-proxy.avi",
                },
            )
            response = connection.getresponse()
            body = json.loads(response.read().decode("utf-8"))
            assert response.status == 202, body
            job_id = body["id"]

            samples = []
            deadline = time.time() + 180
            while time.time() < deadline:
                status_connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                status_connection.request("GET", f"/api/analyze/status?id={job_id}")
                status_response = status_connection.getresponse()
                status = json.loads(status_response.read().decode("utf-8"))
                assert status_response.status == 200, status
                samples.append({
                    "progress": status["progress"],
                    "eta": status.get("etaSeconds"),
                    "fps": status.get("processingFps"),
                    "processed": status.get("processedSeconds"),
                })
                if status["status"] == "completed":
                    break
                assert status["status"] not in {"failed", "cancelled"}, status
                time.sleep(0.4)

            assert status["status"] == "completed", status
            positive_eta = [sample["eta"] for sample in samples if sample["eta"] and sample["eta"] > 0]
            assert len(positive_eta) >= 2, positive_eta
            assert positive_eta[-1] <= positive_eta[0] + 3, positive_eta
            assert max(sample["progress"] for sample in samples) == 1
            print(json.dumps({
                "source": str(source),
                "proxy_duration": round(proxy_duration, 2),
                "proxy_megabytes": round(proxy.stat().st_size / 1024 / 1024, 2),
                "progress_samples": len(samples),
                "positive_eta_samples": positive_eta,
                "peak_processing_fps": round(max(sample["fps"] or 0 for sample in samples), 2),
            }, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    run()
