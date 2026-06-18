from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run():
    app_js = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
    styles = (ROOT / "app" / "styles.css").read_text(encoding="utf-8")
    html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")

    assert 'id="timeline"' in html
    assert "timeline-playhead" in app_js
    assert "updatePlaybackProgress" in app_js
    assert '$("timeline").addEventListener("click"' in app_js
    assert ".timeline-playhead" in styles
    assert "video.currentTime / state.duration" in app_js
    print("Frontend timeline playhead contract passed.")


if __name__ == "__main__":
    run()
