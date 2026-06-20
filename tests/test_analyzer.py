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
    from analyzer.analyze_video import filter_moving_track

    stationary_light = [
        {"time": index * 0.1, "x": 100 + (index % 2) * 0.1, "y": 20, "interpolated": False}
        for index in range(8)
    ]
    moving_ball = [
        {"time": index * 0.1, "x": 100 + index * 4, "y": 20 + index * 2, "interpolated": False}
        for index in range(8)
    ]
    assert not filter_moving_track(stationary_light, 550), "stationary light leaked into trajectory"
    assert len(filter_moving_track(moving_ball, 550)) == len(moving_ball)
    assert 0 <= result["quality"]["cameraStability"] <= 1
    assert result["quality"]["medianSharpness"] > 0
    assert result["quality"]["medianBrightness"] > 0
    assert result["quality"]["recommendations"]
    assert result["capabilities"]["ballTracking"]["enabled"] is True
    assert result["capabilities"]["hitDecision"]["enabled"] is True
    assert result["capabilities"]["poseDetection"]["enabled"] is False
    assert result["capabilities"]["racketDetection"]["enabled"] is False
    assert all(event.get("activityRegion") for event in result["events"])
    assert result["criteria"]["cameraAngle"] == "自动"
    assert all("suggestedShotType" in event for event in result["events"])

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

    camera_metrics = {}
    for camera_angle in ("baseline", "sideline", "handheld"):
        camera_result = analyze_video(
            fixture,
            sport="tennis",
            strength=2,
            sensitivity=2,
            preset="fast",
            camera_angle=camera_angle,
        )
        camera_events = [event["timestamp"] for event in camera_result["events"]]
        camera_matched = sum(
            nearest_error(camera_events, expected) <= 0.55
            for expected in HIT_TIMES
        )
        camera_metrics[camera_angle] = {
            "events": [round(value, 2) for value in camera_events],
            "matched_hits": camera_matched,
        }
        assert camera_matched >= len(HIT_TIMES) - 1, camera_metrics[camera_angle]
        assert len(camera_events) <= len(HIT_TIMES) + 2, camera_metrics[camera_angle]
    print(json.dumps({"camera_profiles": camera_metrics}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
