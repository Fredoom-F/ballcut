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
    assert 0 <= result["quality"]["cameraStability"] <= 1
    assert result["quality"]["medianSharpness"] > 0
    assert result["quality"]["medianBrightness"] > 0
    assert result["quality"]["recommendations"]

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

    blue_ball_fixture = ROOT / "tests" / "fixtures" / "synthetic-blue-ball.avi"
    generate(blue_ball_fixture, ball_bgr=(30, 30, 240))
    calibrated_result = analyze_video(
        blue_ball_fixture,
        "tennis",
        strength=3,
        ball_rgb=[240, 30, 30],
    )
    calibrated_times = [event["timestamp"] for event in calibrated_result["events"]]
    calibrated_matches = sum(nearest_error(calibrated_times, expected) <= 0.55 for expected in HIT_TIMES)
    print(
        json.dumps(
            {
                "calibrated_ball": {
                    "events": calibrated_times,
                    "trajectory_points": len(calibrated_result["trajectory"]),
                    "matched_hits": calibrated_matches,
                }
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    assert len(calibrated_result["trajectory"]) >= 70
    assert calibrated_matches >= 4

    preset_metrics = {}
    for preset in ["fast", "precise"]:
        preset_result = analyze_video(fixture, "tennis", strength=3, preset=preset)
        preset_times = [event["timestamp"] for event in preset_result["events"]]
        preset_matches = sum(nearest_error(preset_times, expected) <= 0.65 for expected in HIT_TIMES)
        preset_metrics[preset] = {
            "sample_fps": preset_result["source"]["sampleFps"],
            "events": preset_times,
            "matched_hits": preset_matches,
        }
        if preset == "fast":
            assert preset_matches >= 3
        else:
            assert preset_matches >= 4
    print(json.dumps({"analysis_presets": preset_metrics}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
