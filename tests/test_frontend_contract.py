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
    assert "analysisProgressBar" in app_js
    assert "formatRemaining" in app_js
    assert "uploadAnalysisJob" in app_js
    assert "waitForAnalysisResult" in app_js
    assert "cancelAnalysis" in app_js
    assert 'id="analysisEta"' in html
    assert 'id="cancelAnalyzeBtn"' in html
    assert 'id="addHitBtn"' in html
    assert "addHitAtCurrentTime" in app_js
    assert "reviewStatus" in app_js
    assert "renderCuts" in app_js
    assert "rebuildHighlights" in app_js
    assert 'id="trainingReport"' in html
    assert "buildTrainingSummary" in app_js
    assert "downloadTrainingReport" in app_js
    assert "getHighlightScore" in app_js
    assert "getExportSegments" in app_js
    assert "favorite" in app_js
    assert 'id="reuseCache"' in html
    assert "indexedDB.open" in app_js
    assert "readAnalysisCache" in app_js
    assert "writeAnalysisCache" in app_js
    assert 'id="calibrateBallBtn"' in html
    assert "sampleBallColor" in app_js
    assert "ballColor" in app_js
    assert "cameraStability" in app_js
    assert "recommendations" in app_js
    assert "projectStoreName" in app_js
    assert "writeProjectEdits" in app_js
    assert "applyProjectEdits" in app_js
    assert 'id="previousEventBtn"' in html
    assert 'id="nextEventBtn"' in html
    assert "navigateEvent" in app_js
    assert "handleEditorShortcut" in app_js
    assert 'id="hitSensitivity"' in html
    assert "sensitivity" in app_js
    assert "text/html;charset=utf-8" in app_js
    assert "剪球训练报告" in app_js
    print("Frontend timeline playhead contract passed.")


if __name__ == "__main__":
    run()
