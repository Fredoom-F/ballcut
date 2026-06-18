import http.client
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "synthetic-tennis.avi"
sys.path.insert(0, str(ROOT))


def wait_for_server(timeout=8):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=1)
            connection.request("GET", "/health")
            response = connection.getresponse()
            if response.status == 200:
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("test server did not start")


def run():
    from tests.generate_synthetic_video import generate

    generate(FIXTURE)
    environment = {"PORT": "4183"}
    process = subprocess.Popen(
        ["node", "server.js"],
        cwd=ROOT / "app",
        env={**dict(__import__("os").environ), **environment},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        wait_for_server()
        payload = FIXTURE.read_bytes()
        connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=120)
        connection.request(
            "POST",
            "/api/analyze?sport=tennis&strength=3",
            body=payload,
            headers={"Content-Type": "application/octet-stream", "Content-Length": str(len(payload))},
        )
        response = connection.getresponse()
        body = response.read().decode("utf-8")
        assert response.status == 200, body
        result = json.loads(body)
        assert result["analysisType"] == "opencv-local"
        assert len(result["events"]) == 4
        assert len(result["trajectory"]) >= 70

        leftovers = list(Path(tempfile.gettempdir()).glob("jianqiu-*.video"))
        assert not leftovers, f"temporary uploads were not deleted: {leftovers}"
        print(
            json.dumps(
                {
                    "status": response.status,
                    "events": len(result["events"]),
                    "trajectory_points": len(result["trajectory"]),
                    "temporary_files": len(leftovers),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    run()
