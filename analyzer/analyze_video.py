import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


SPORT_CONFIG = {
    "tennis": {
        "name": "网球",
        "ranges": [((18, 105, 115), (45, 255, 255))],
        "max_area_ratio": 0.006,
    },
    "badminton": {
        "name": "羽毛球",
        "ranges": [((0, 0, 145), (180, 90, 255))],
        "max_area_ratio": 0.004,
    },
    "tabletennis": {
        "name": "乒乓球",
        "ranges": [((4, 80, 110), (28, 255, 255)), ((0, 0, 175), (180, 65, 255))],
        "max_area_ratio": 0.003,
    },
    "basketball": {
        "name": "篮球",
        "ranges": [((3, 70, 70), (25, 255, 255))],
        "max_area_ratio": 0.025,
    },
    "football": {
        "name": "足球",
        "ranges": [((0, 0, 145), (180, 100, 255))],
        "max_area_ratio": 0.025,
    },
    "golf": {
        "name": "高尔夫",
        "ranges": [((0, 0, 175), (180, 65, 255))],
        "max_area_ratio": 0.002,
    },
}


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def merge_ranges(ranges, gap=0.45):
    if not ranges:
        return []
    ranges = sorted(ranges)
    merged = [list(ranges[0])]
    for start, end in ranges[1:]:
        if start <= merged[-1][1] + gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [{"start": round(a, 3), "end": round(b, 3)} for a, b in merged if b > a]


def make_color_mask(hsv, config):
    result = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lower, upper in config["ranges"]:
        result = cv2.bitwise_or(
            result,
            cv2.inRange(hsv, np.array(lower, dtype=np.uint8), np.array(upper, dtype=np.uint8)),
        )
    return result


def contour_candidates(frame, previous_gray, config, last_point, predicted_point):
    height, width = frame.shape[:2]
    frame_area = width * height
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    color_mask = make_color_mask(hsv, config)

    if previous_gray is None:
        motion_mask = np.zeros_like(gray)
        motion_energy = 0.0
        camera_shift = 0.0
    else:
        shift, _ = cv2.phaseCorrelate(np.float32(previous_gray), np.float32(gray))
        camera_shift = math.hypot(shift[0], shift[1])
        difference = cv2.absdiff(gray, previous_gray)
        difference = cv2.GaussianBlur(difference, (5, 5), 0)
        _, motion_mask = cv2.threshold(difference, 18, 255, cv2.THRESH_BINARY)
        motion_mask = cv2.morphologyEx(motion_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        motion_mask = cv2.dilate(motion_mask, np.ones((5, 5), np.uint8), iterations=1)
        motion_energy = float(np.count_nonzero(motion_mask)) / frame_area

    activity_regions = []
    activity_contours, _ = cv2.findContours(motion_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in activity_contours:
        area = cv2.contourArea(contour)
        if area < frame_area * 0.001 or area > frame_area * 0.25:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        activity_regions.append(
            {
                "x": x / width,
                "y": y / height,
                "w": w / width,
                "h": h / height,
                "area": area / frame_area,
            }
        )

    candidate_mask = cv2.bitwise_and(color_mask, motion_mask)
    candidate_mask = cv2.morphologyEx(candidate_mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(candidate_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []
    max_area = max(18.0, frame_area * config["max_area_ratio"])
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < 2.0 or area > max_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if w > width * 0.22 or h > height * 0.22:
            continue
        perimeter = cv2.arcLength(contour, True)
        circularity = 4 * math.pi * area / (perimeter * perimeter) if perimeter else 0
        cx = x + w / 2
        cy = y + h / 2
        shape_score = clamp(circularity, 0.0, 1.0)
        size_score = clamp(area / 18.0, 0.0, 1.0) * (1.0 - 0.55 * clamp(area / max_area, 0.0, 1.0))
        border_distance = min(cx, cy, width - cx, height - cy)
        border_score = clamp(border_distance / max(12.0, min(width, height) * 0.08), 0.0, 1.0)
        distance_score = 0.35
        reference = predicted_point or last_point
        distance = None
        if reference:
            distance = math.dist((cx, cy), reference)
            diagonal = math.hypot(width, height)
            distance_score = math.exp(-distance / max(32.0, diagonal * 0.45))
        score = 0.35 * shape_score + 0.27 * size_score + 0.28 * distance_score + 0.10 * border_score
        candidates.append(
            {
                "x": cx,
                "y": cy,
                "area": area,
                "score": score,
                "distance": distance,
            }
        )

    candidates.sort(key=lambda item: item["score"], reverse=True)
    return gray, motion_energy, camera_shift, activity_regions, candidates


def choose_candidate(candidates, last_point, predicted_point, frame_diagonal):
    if not candidates:
        return None
    if last_point is None:
        return candidates[0] if candidates[0]["score"] >= 0.32 else None

    max_jump = frame_diagonal * 0.22
    plausible = [
        item
        for item in candidates
        if item["distance"] is None or item["distance"] <= max_jump
    ]
    if not plausible:
        return None
    return max(plausible, key=lambda item: item["score"])


def point_near_activity(point, regions, padding_x=0.10, padding_up=0.34, padding_down=0.10):
    for region in regions:
        if (
            region["x"] - padding_x <= point["xNorm"] <= region["x"] + region["w"] + padding_x
            and region["y"] - padding_up <= point["yNorm"] <= region["y"] + region["h"] + padding_down
        ):
            return True
    return False


def rolling_camera_stable(motion_samples, timestamp, window=0.55):
    nearby = [sample for sample in motion_samples if abs(sample["time"] - timestamp) <= window]
    if not nearby:
        return False
    shifts = np.array([sample["cameraShift"] for sample in nearby], dtype=np.float32)
    energies = np.array([sample["energy"] for sample in nearby], dtype=np.float32)
    return float(np.percentile(shifts, 75)) <= 2.0 and float(np.percentile(energies, 65)) <= 0.25


def point_in_sport_event_area(point, sport):
    if sport in {"tennis", "badminton"}:
        return 0.03 <= point["xNorm"] <= 0.97 and 0.16 <= point["yNorm"] <= 0.90
    return 0.02 <= point["xNorm"] <= 0.98 and 0.04 <= point["yNorm"] <= 0.96


def detect_events(track, sample_fps, frame_diagonal, sport, motion_samples):
    events = []
    if len(track) < 5:
        return events

    min_speed = frame_diagonal * 0.09
    acceleration_threshold = frame_diagonal * 0.18
    for index in range(2, len(track) - 2):
        before = track[index - 2]
        center = track[index]
        after = track[index + 2]
        local_points = track[index - 2 : index + 3]
        if any(
            local_points[position + 1]["time"] - local_points[position]["time"] > 0.35
            for position in range(len(local_points) - 1)
        ):
            continue
        dt_before = center["time"] - before["time"]
        dt_after = after["time"] - center["time"]
        if dt_before <= 0 or dt_after <= 0:
            continue

        v1 = np.array(
            [(center["x"] - before["x"]) / dt_before, (center["y"] - before["y"]) / dt_before]
        )
        v2 = np.array(
            [(after["x"] - center["x"]) / dt_after, (after["y"] - center["y"]) / dt_after]
        )
        speed_before = float(np.linalg.norm(v1))
        speed_after = float(np.linalg.norm(v2))
        denominator = speed_before * speed_after
        direction_cosine = float(np.dot(v1, v2) / denominator) if denominator else 1.0
        acceleration = float(np.linalg.norm(v2 - v1))

        direction_reversal = direction_cosine < -0.48
        speed_ratio = max(speed_before, speed_after) / max(1.0, min(speed_before, speed_after))
        sharp_acceleration = acceleration > acceleration_threshold and speed_ratio > 2.2
        moving = max(speed_before, speed_after) > min_speed
        racket_sports = {"tennis", "badminton", "tabletennis"}
        event_signal = direction_reversal if sport in racket_sports else (direction_reversal or sharp_acceleration)
        activity = min(motion_samples, key=lambda item: abs(item["time"] - center["time"]))
        stable_camera = rolling_camera_stable(motion_samples, center["time"])
        near_player_motion = point_near_activity(center, activity["regions"])
        in_event_area = point_in_sport_event_area(center, sport)
        if not moving or not event_signal or not stable_camera or not near_player_motion or not in_event_area:
            continue

        continuity = sum(1 for point in track[max(0, index - 3) : index + 4] if not point["interpolated"]) / 7
        confidence = clamp(
            0.30
            + (0.32 * clamp((-direction_cosine + 0.1) / 1.1, 0, 1))
            + (0.25 * clamp(acceleration / (acceleration_threshold * 2), 0, 1))
            + (0.13 * continuity),
            0,
            0.96,
        )

        event = {
            "id": f"event_{len(events) + 1}",
            "type": "hit",
            "label": "疑似击球",
            "timestamp": round(center["time"], 3),
            "confidence": round(confidence, 3),
            "score": round(confidence, 3),
            "position": {"x": center["xNorm"], "y": center["yNorm"]},
            "evidence": {
                "directionChangeDegrees": round(math.degrees(math.acos(clamp(direction_cosine, -1, 1))), 1),
                "speedBeforePxPerSec": round(speed_before, 1),
                "speedAfterPxPerSec": round(speed_after, 1),
                "accelerationPxPerSec": round(acceleration, 1),
                "speedRatio": round(speed_ratio, 2),
                "trackContinuity": round(continuity, 2),
                "cameraShiftPx": round(activity["cameraShift"], 2),
                "motionEnergy": round(activity["energy"], 3),
                "nearPlayerMotion": near_player_motion,
                "inEventArea": in_event_area,
            },
        }
        if events and event["timestamp"] - events[-1]["timestamp"] < 0.65:
            if event["confidence"] > events[-1]["confidence"]:
                event["id"] = events[-1]["id"]
                events[-1] = event
        else:
            events.append(event)
    return events


def build_segments(duration, track, events, motion_samples, strength, frame_diagonal):
    active_ranges = []
    padding = {1: 3.2, 2: 2.2, 3: 1.4}.get(strength, 2.2)

    movement_threshold = frame_diagonal * 0.05
    for index in range(1, len(track)):
        previous = track[index - 1]
        point = track[index]
        dt = point["time"] - previous["time"]
        if dt <= 0 or dt > 0.45:
            continue
        speed = math.dist((point["x"], point["y"]), (previous["x"], previous["y"])) / dt
        if speed >= movement_threshold and rolling_camera_stable(motion_samples, point["time"]):
            active_ranges.append((max(0, point["time"] - 0.45), min(duration, point["time"] + 0.45)))
    for event in events:
        active_ranges.append((max(0, event["timestamp"] - padding), min(duration, event["timestamp"] + padding)))

    if motion_samples:
        energies = np.array([sample["energy"] for sample in motion_samples], dtype=np.float32)
        threshold = max(0.006, float(np.percentile(energies, 58)) * 0.72)
        for sample in motion_samples:
            if (
                sample["energy"] >= threshold
                and sample["energy"] <= 0.25
                and rolling_camera_stable(motion_samples, sample["time"])
            ):
                active_ranges.append((max(0, sample["time"] - 0.5), min(duration, sample["time"] + 0.5)))

    active = merge_ranges(active_ranges, gap=0.7)
    if not active:
        return [{"id": "keep_0", "start": 0, "end": round(duration, 3), "type": "keep"}]

    minimum_idle = {1: 10.0, 2: 6.5, 3: 4.0}.get(strength, 6.5)
    segments = []
    cursor = 0.0
    segment_index = 0
    for region in active:
        if region["start"] - cursor >= minimum_idle:
            segments.append(
                {
                    "id": f"remove_{segment_index}",
                    "start": round(cursor, 3),
                    "end": region["start"],
                    "type": "remove",
                    "reason": "低运动量且未追踪到球",
                }
            )
            segment_index += 1
        elif region["start"] > cursor:
            segments.append(
                {
                    "id": f"keep_{segment_index}",
                    "start": round(cursor, 3),
                    "end": region["start"],
                    "type": "keep",
                }
            )
            segment_index += 1
        segments.append(
            {
                "id": f"keep_{segment_index}",
                "start": region["start"],
                "end": region["end"],
                "type": "keep",
            }
        )
        segment_index += 1
        cursor = region["end"]

    if duration - cursor >= minimum_idle:
        segments.append(
            {
                "id": f"remove_{segment_index}",
                "start": round(cursor, 3),
                "end": round(duration, 3),
                "type": "remove",
                "reason": "低运动量且未追踪到球",
            }
        )
    elif cursor < duration:
        segments.append(
            {
                "id": f"keep_{segment_index}",
                "start": round(cursor, 3),
                "end": round(duration, 3),
                "type": "keep",
            }
        )
    return segments


def analyze_video(path, sport="tennis", strength=2, max_seconds=900):
    config = SPORT_CONFIG.get(sport, SPORT_CONFIG["tennis"])
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError("无法读取视频文件")

    source_fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / source_fps if frame_count else 0
    if duration <= 0:
        raise RuntimeError("无法读取视频时长")
    duration = min(duration, max_seconds)

    sample_fps = min(12.0, max(5.0, source_fps))
    frame_step = max(1, round(source_fps / sample_fps))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 1)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1)
    analysis_width = min(480, width)
    scale = analysis_width / width
    analysis_height = max(1, round(height * scale))
    frame_diagonal = math.hypot(analysis_width, analysis_height)

    previous_gray = None
    last_point = None
    previous_point = None
    missing_frames = 0
    track = []
    motion_samples = []
    frame_index = 0

    while capture.isOpened():
        ok, frame = capture.read()
        if not ok:
            break
        timestamp = frame_index / source_fps
        if timestamp > duration:
            break
        if frame_index % frame_step:
            frame_index += 1
            continue

        frame = cv2.resize(frame, (analysis_width, analysis_height), interpolation=cv2.INTER_AREA)
        predicted = None
        if last_point and previous_point:
            predicted = (
                last_point[0] + (last_point[0] - previous_point[0]),
                last_point[1] + (last_point[1] - previous_point[1]),
            )
        gray, motion_energy, camera_shift, activity_regions, candidates = contour_candidates(
            frame, previous_gray, config, last_point, predicted
        )
        motion_samples.append(
            {
                "time": round(timestamp, 3),
                "energy": round(motion_energy, 5),
                "cameraShift": round(camera_shift, 4),
                "regions": activity_regions,
            }
        )
        chosen = choose_candidate(candidates, last_point, predicted, frame_diagonal)

        if chosen:
            previous_point = last_point
            last_point = (chosen["x"], chosen["y"])
            missing_frames = 0
            track.append(
                {
                    "time": round(timestamp, 3),
                    "x": round(chosen["x"], 2),
                    "y": round(chosen["y"], 2),
                    "xNorm": round(chosen["x"] / analysis_width, 5),
                    "yNorm": round(chosen["y"] / analysis_height, 5),
                    "confidence": round(clamp(chosen["score"], 0, 0.95), 3),
                    "interpolated": False,
                }
            )
        else:
            missing_frames += 1
            if missing_frames > round(sample_fps * 0.5):
                last_point = None
                previous_point = None

        previous_gray = gray
        frame_index += 1

    capture.release()
    events = detect_events(track, sample_fps, frame_diagonal, sport, motion_samples)
    segments = build_segments(duration, track, events, motion_samples, strength, frame_diagonal)
    stable_track = [
        point
        for point in track
        if rolling_camera_stable(motion_samples, point["time"])
        and 0.02 <= point["xNorm"] <= 0.98
        and 0.04 <= point["yNorm"] <= 0.96
    ]
    highlights = [
        {
            "id": f"highlight_{index + 1}",
            "start": round(max(0, event["timestamp"] - 2.2), 3),
            "end": round(min(duration, event["timestamp"] + 3.0), 3),
            "score": event["score"],
            "reason": "球轨迹发生明显方向或速度变化",
        }
        for index, event in enumerate(events)
        if event["confidence"] >= 0.58
    ]

    tracked_seconds = len(stable_track) / sample_fps
    return {
        "version": 2,
        "analysisType": "opencv-local",
        "sport": sport,
        "sportName": config["name"],
        "duration": round(duration, 3),
        "source": {
            "fps": round(source_fps, 3),
            "width": width,
            "height": height,
            "sampleFps": round(sample_fps, 3),
        },
        "quality": {
            "trackedPoints": len(stable_track),
            "trackedSeconds": round(tracked_seconds, 2),
            "coverage": round(clamp(tracked_seconds / duration, 0, 1), 3),
            "warning": None
            if len(stable_track) >= 8
            else "没有形成稳定球轨迹。请确认运动类型、球的颜色和视频清晰度。",
        },
        "trajectory": stable_track,
        "events": events,
        "segments": segments,
        "highlights": highlights,
        "criteria": {
            "ballCandidate": "运动区域与该运动球色范围的交集，并按面积、圆度和轨迹连续性评分",
            "hit": "球轨迹连续、镜头稳定、候选靠近人体尺度运动区域，且方向变化或速度变化超过阈值",
            "idle": "持续低运动量且没有可靠移动球轨迹；全局镜头大幅移动也不计为有效运动",
            "highlight": "置信度不低于 0.58 的疑似击球事件前后片段",
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("--sport", default="tennis")
    parser.add_argument("--strength", type=int, default=2)
    parser.add_argument("--output")
    args = parser.parse_args()
    result = analyze_video(Path(args.video), args.sport, args.strength)
    payload = json.dumps(result, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(payload, encoding="utf-8")
    else:
        sys.stdout.buffer.write(payload.encode("utf-8"))


if __name__ == "__main__":
    main()
