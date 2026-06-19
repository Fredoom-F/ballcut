import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analyzer.analyze_video import analyze_video


DEFAULT_VIDEO = Path.home() / "Downloads" / "VID_20260117_185203.mp4"
EXPECTED_EVENTS = [27.14, 30.83, 55.98, 59.77, 66.85, 75.63, 79.32]
EXPECTED_REMOVALS = [(0.0, 12.5), (42.1, 50.4), (87.8, 115.4)]


def nearest_error(actual, expected):
    return min((abs(value - expected) for value in actual), default=float("inf"))


def interval_overlap(first, second):
    return max(0.0, min(first[1], second[1]) - max(first[0], second[0]))


def run():
    video = Path(os.environ.get("JIANQIU_REAL_VIDEO", DEFAULT_VIDEO))
    if not video.exists():
        print(f"Real-video regression skipped: {video} does not exist.")
        return

    started = time.perf_counter()
    result = analyze_video(video, "tennis", strength=2, sensitivity=2)
    elapsed = time.perf_counter() - started
    actual_events = [event["timestamp"] for event in result["events"]]
    matched = sum(nearest_error(actual_events, expected) <= 0.8 for expected in EXPECTED_EVENTS)
    removals = [
        (segment["start"], segment["end"])
        for segment in result["segments"]
        if segment["type"] == "remove"
    ]
    removal_matches = sum(
        max((interval_overlap(actual, expected) for actual in removals), default=0) >= (expected[1] - expected[0]) * 0.7
        for expected in EXPECTED_REMOVALS
    )

    metrics = {
        "video": str(video),
        "elapsed_seconds": round(elapsed, 2),
        "events": [round(value, 2) for value in actual_events],
        "matched_events": matched,
        "trajectory_points": len(result["trajectory"]),
        "removals": [[round(a, 1), round(b, 1)] for a, b in removals],
        "matched_removals": removal_matches,
    }
    print(json.dumps(metrics, ensure_ascii=False, indent=2))

    assert matched >= 7, "real-video hit regression"
    assert len(actual_events) <= 9, "real-video false positives increased"
    assert len(result["trajectory"]) >= 180, "real-video trajectory became too sparse"
    assert removal_matches >= 3, "real-video idle segmentation regressed"
    assert elapsed <= 80, "real-video analysis performance regressed"


if __name__ == "__main__":
    run()
