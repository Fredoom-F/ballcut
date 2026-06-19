import http.client
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = Path(tempfile.gettempdir()) / f"ballcut-api-fixture-{os.getpid()}.avi"
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
        env={**dict(os.environ), **environment},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        wait_for_server()
        payload = FIXTURE.read_bytes()

        health_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        health_connection.request("GET", "/health")
        health_response = health_connection.getresponse()
        health = json.loads(health_response.read().decode("utf-8"))
        assert health_response.status == 200
        assert health["version"] == "0.4.2"
        assert health["analyzerReady"] is True
        assert health_response.getheader("X-Content-Type-Options") == "nosniff"
        assert health_response.getheader("Cross-Origin-Resource-Policy") == "same-origin"

        page_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        page_connection.request("GET", "/")
        page_response = page_connection.getresponse()
        assert page_response.status == 200
        assert "frame-ancestors 'none'" in page_response.getheader("Content-Security-Policy")
        assert page_response.getheader("Permissions-Policy")
        page_response.read()

        traversal_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        traversal_connection.request("GET", "/..%2F..%2Fapp%2Fserver.js")
        traversal_response = traversal_connection.getresponse()
        assert traversal_response.status == 403
        assert traversal_response.getheader("X-Content-Type-Options") == "nosniff"
        traversal_response.read()

        empty_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        empty_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis",
            body=b"",
            headers={"Content-Type": "application/octet-stream", "Content-Length": "0"},
        )
        empty_response = empty_connection.getresponse()
        assert empty_response.status == 400
        empty_response.read()

        oversized_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        oversized_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis",
            body=b"",
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Length": str(1024 * 1024 * 1024 + 1),
            },
        )
        oversized_response = oversized_connection.getresponse()
        assert oversized_response.status == 413
        oversized_response.read()

        invalid_angle_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        invalid_angle_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis&cameraAngle=unknown",
            body=b"",
            headers={"Content-Type": "application/octet-stream", "Content-Length": "0"},
        )
        invalid_angle_response = invalid_angle_connection.getresponse()
        assert invalid_angle_response.status == 400
        invalid_angle_response.read()

        system_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        system_connection.request("GET", "/api/system")
        system_response = system_connection.getresponse()
        system_state = json.loads(system_response.read().decode("utf-8"))
        assert system_response.status == 200
        assert system_state["ready"] is True
        assert system_state["opencv"]
        assert system_state["serviceVersion"] == "0.4.2"

        cross_origin_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        cross_origin_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis",
            body=b"not-a-video",
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Length": "11",
                "Origin": "https://example.com",
            },
        )
        cross_origin_response = cross_origin_connection.getresponse()
        assert cross_origin_response.status == 403
        cross_origin_response.read()

        wrong_type_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        wrong_type_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis",
            body=b"not-a-video",
            headers={"Content-Type": "text/plain", "Content-Length": "11"},
        )
        wrong_type_response = wrong_type_connection.getresponse()
        assert wrong_type_response.status == 415
        wrong_type_response.read()

        connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=120)
        connection.request(
            "POST",
            "/api/analyze?sport=tennis&strength=3",
            body=payload,
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Length": str(len(payload)),
                "X-Jianqiu-File-Name": "synthetic-tennis.avi",
            },
        )
        response = connection.getresponse()
        body = response.read().decode("utf-8")
        assert response.status == 200, body
        result = json.loads(body)
        assert result["analysisType"] == "opencv-local"
        assert len(result["events"]) == 4
        assert len(result["trajectory"]) >= 70

        async_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=120)
        async_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis&strength=3",
            body=payload,
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Length": str(len(payload)),
                "X-Jianqiu-File-Name": "synthetic-tennis.avi",
            },
        )
        async_response = async_connection.getresponse()
        async_body = async_response.read().decode("utf-8")
        assert async_response.status == 202, async_body
        job_id = json.loads(async_body)["id"]

        observed_progress = []
        observed_eta = []
        deadline = time.time() + 120
        status = None
        while time.time() < deadline:
            status_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
            status_connection.request("GET", f"/api/analyze/status?id={job_id}")
            status_response = status_connection.getresponse()
            status = json.loads(status_response.read().decode("utf-8"))
            assert status_response.status == 200, status
            observed_progress.append(status["progress"])
            if status.get("etaSeconds") is not None:
                observed_eta.append(status["etaSeconds"])
            if status["status"] == "completed":
                break
            assert status["status"] not in {"failed", "cancelled"}, status
            time.sleep(0.25)

        assert status and status["status"] == "completed", status
        assert max(observed_progress) >= 0.9, observed_progress
        assert observed_eta, "analysis never reported an ETA"
        assert any(value > 0 for value in observed_eta), observed_eta
        positive_eta = [value for value in observed_eta if value > 0]
        assert positive_eta[-1] <= positive_eta[0] + 2, positive_eta

        result_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        result_connection.request("GET", f"/api/analyze/result?id={job_id}")
        result_response = result_connection.getresponse()
        async_result = json.loads(result_response.read().decode("utf-8"))
        assert result_response.status == 200, async_result
        assert len(async_result["events"]) == 4

        cancel_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=120)
        cancel_connection.request(
            "POST",
            "/api/analyze/start?sport=tennis&strength=3",
            body=payload,
            headers={"Content-Type": "application/octet-stream", "Content-Length": str(len(payload))},
        )
        cancel_start_response = cancel_connection.getresponse()
        cancel_start_body = json.loads(cancel_start_response.read().decode("utf-8"))
        assert cancel_start_response.status == 202, cancel_start_body
        cancel_job_id = cancel_start_body["id"]

        delete_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        delete_connection.request("DELETE", f"/api/analyze/cancel?id={cancel_job_id}")
        delete_response = delete_connection.getresponse()
        cancelled = json.loads(delete_response.read().decode("utf-8"))
        assert delete_response.status == 200, cancelled
        assert cancelled["status"] == "cancelled", cancelled
        time.sleep(0.75)

        cancelled_status_connection = http.client.HTTPConnection("127.0.0.1", 4183, timeout=10)
        cancelled_status_connection.request("GET", f"/api/analyze/status?id={cancel_job_id}")
        cancelled_status_response = cancelled_status_connection.getresponse()
        cancelled_status = json.loads(cancelled_status_response.read().decode("utf-8"))
        assert cancelled_status["status"] == "cancelled", cancelled_status

        leftovers = [
            item
            for item in Path(tempfile.gettempdir()).glob("jianqiu-*")
            if item.suffix.lower() in {".video", ".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"}
        ]
        assert not leftovers, f"temporary uploads were not deleted: {leftovers}"
        print(
            json.dumps(
                {
                    "status": response.status,
                    "events": len(result["events"]),
                    "trajectory_points": len(result["trajectory"]),
                    "progress_samples": len(observed_progress),
                    "eta_samples": len(observed_eta),
                    "cancel_status": cancelled_status["status"],
                    "cross_origin_status": cross_origin_response.status,
                    "wrong_type_status": wrong_type_response.status,
                    "opencv_version": system_state["opencv"],
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
        FIXTURE.unlink(missing_ok=True)


if __name__ == "__main__":
    run()
