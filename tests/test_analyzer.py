import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analyzer.analyze_video import analyze_video
from tests.generate_synthetic_video import HIT_TIMES, generate, generate_no_ball


def nearest_error(actual_times, expected):
    if not actual_times:
        return float("inf")
    return min(abs(value - expected) for value in actual_times)


def run():
    fixture = ROOT / "tests" / "fixtures" / "synthetic-tennis.avi"
    generate(fixture)
    result = analyze_video(fixture, "tennis", strength=3)
    actual = [event["timestamp"] for event in result["events"]]
    errors = [nearest_error(actual, expected) for expected in HIT_TIMES]
    matched = sum(error <= 0.55 for error in errors)
    idle_overlap = 0.0
    for segment in result["segments"]:
        if segment["type"] != "remove":
            continue
        idle_overlap += max(0.0, min(segment["end"], 12.0) - max(segment["start"], 7.0))

    metrics = {
        "expected_hits": HIT_TIMES,
        "detected_hits": actual,
        "matched_hits": matched,
        "mean_hit_error": round(sum(error for error in errors if error != float("inf")) / len(errors), 3),
        "trajectory_points": len(result["trajectory"]),
        "coverage": result["quality"]["coverage"],
        "idle_overlap_seconds": round(idle_overlap, 3),
        "warning": result["quality"]["warning"],
    }
    print(json.dumps(metrics, ensure_ascii=False, indent=2))

    assert len(result["trajectory"]) >= 70, "trajectory is too sparse"
    assert result["quality"]["coverage"] >= 0.42, "trajectory coverage is too low"
    assert matched >= 4, "hit recall is below delivery threshold"
    assert idle_overlap >= 2.5, "idle segment was not identified"
    assert len(actual) <= 10, "too many false hit candidates"

    no_ball_fixture = ROOT / "tests" / "fixtures" / "synthetic-no-ball.avi"
    generate_no_ball(no_ball_fixture)
    no_ball_result = analyze_video(no_ball_fixture, "tennis", strength=2)
    no_ball_metrics = {
        "events": len(no_ball_result["events"]),
        "trajectory_points": len(no_ball_result["trajectory"]),
        "warning": no_ball_result["quality"]["warning"],
    }
    print(json.dumps({"no_ball_video": no_ball_metrics}, ensure_ascii=False, indent=2))
    assert len(no_ball_result["events"]) == 0, "no-ball video produced false hit events"
    assert no_ball_result["quality"]["warning"], "no-ball video must explain that tracking failed"


if __name__ == "__main__":
    run()
