from pathlib import Path

import cv2
import numpy as np


WIDTH = 960
HEIGHT = 540
FPS = 30
DURATION = 16
HIT_TIMES = [2.0, 4.0, 6.0, 14.0]


def ball_position(t):
    if t < 7:
        phase = (t % 2.0) / 2.0
        direction = int(t // 2.0) % 2
        x = 230 + phase * 500 if direction == 0 else 730 - phase * 500
        y = 275 - 105 * np.sin(phase * np.pi)
        return int(x), int(y)
    if t < 12:
        return 165, 445
    phase = ((t - 12) % 2.0) / 2.0
    direction = int((t - 12) // 2.0) % 2
    x = 230 + phase * 500 if direction == 0 else 730 - phase * 500
    y = 275 - 105 * np.sin(phase * np.pi)
    return int(x), int(y)


def draw_player(frame, x, y, color, racket_side=1):
    cv2.circle(frame, (x, y - 58), 17, color, -1)
    cv2.line(frame, (x, y - 40), (x, y + 22), color, 9)
    cv2.line(frame, (x, y - 12), (x + 42 * racket_side, y - 32), color, 8)
    cv2.line(frame, (x, y + 22), (x - 28, y + 74), color, 8)
    cv2.line(frame, (x, y + 22), (x + 30, y + 72), color, 8)
    hand = (x + 42 * racket_side, y - 32)
    racket = (x + 72 * racket_side, y - 45)
    cv2.line(frame, hand, racket, (210, 210, 210), 4)
    cv2.ellipse(frame, (x + 88 * racket_side, y - 52), (17, 27), 0, 0, 360, (210, 210, 210), 3)


def generate(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"MJPG"),
        FPS,
        (WIDTH, HEIGHT),
    )
    if not writer.isOpened():
        raise RuntimeError("Unable to create synthetic video")

    for frame_index in range(FPS * DURATION):
        t = frame_index / FPS
        frame = np.full((HEIGHT, WIDTH, 3), (45, 104, 65), dtype=np.uint8)
        cv2.rectangle(frame, (90, 65), (870, 475), (235, 235, 235), 4)
        cv2.line(frame, (480, 65), (480, 475), (235, 235, 235), 4)
        cv2.line(frame, (90, 270), (870, 270), (235, 235, 235), 3)

        if t < 7 or t >= 12:
            sway = int(20 * np.sin(t * 2.2))
            draw_player(frame, 205 + sway, 350, (245, 245, 245), 1)
            draw_player(frame, 755 - sway, 245, (245, 150, 70), -1)
        else:
            draw_player(frame, 160, 375, (245, 245, 245), 1)
            draw_player(frame, 780, 245, (245, 150, 70), -1)

        x, y = ball_position(t)
        cv2.circle(frame, (x, y), 11, (45, 240, 245), -1)
        cv2.circle(frame, (x, y), 11, (20, 160, 170), 2)
        cv2.putText(frame, f"t={t:04.1f}", (25, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        writer.write(frame)

    writer.release()
    return {"path": str(path), "hit_times": HIT_TIMES, "idle": [7.0, 12.0]}


def generate_no_ball(path, duration=6):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"MJPG"),
        FPS,
        (WIDTH, HEIGHT),
    )
    if not writer.isOpened():
        raise RuntimeError("Unable to create no-ball video")
    for frame_index in range(FPS * duration):
        t = frame_index / FPS
        frame = np.full((HEIGHT, WIDTH, 3), (45, 104, 65), dtype=np.uint8)
        cv2.rectangle(frame, (90, 65), (870, 475), (235, 235, 235), 4)
        draw_player(frame, 210 + int(18 * np.sin(t)), 350, (245, 245, 245), 1)
        draw_player(frame, 750, 245, (245, 150, 70), -1)
        writer.write(frame)
    writer.release()
    return str(path)


if __name__ == "__main__":
    output = Path(__file__).parent / "fixtures" / "synthetic-tennis.avi"
    print(generate(output))
