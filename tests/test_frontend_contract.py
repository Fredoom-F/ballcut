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
    assert 'id="bestHighlightBtn"' in html
    assert 'id="downloadCoverBtn"' in html
    assert "downloadCover" in app_js
    assert "getBestHighlight" in app_js
    assert 'id="keepAudio"' in html
    assert "getAudioTracks" in app_js
    assert "activeJobStorageKey" in app_js
    assert "resumeActiveAnalysis" in app_js
    assert "X-Jianqiu-Cache-Key" in app_js
    assert 'id="autoSlowMotion"' in html
    assert "updatePreviewPlaybackRate" in app_js
    assert 'id="copyCaptionBtn"' in html
    assert "buildSocialCaption" in app_js
    assert "copySocialCaption" in app_js
    assert 'id="eventFilter"' in html
    assert 'id="confirmHighBtn"' in html
    assert "confirmHighConfidenceEvents" in app_js
    assert 'id="undoEditBtn"' in html
    assert 'id="redoEditBtn"' in html
    assert "undoEdit" in app_js
    assert "redoEdit" in app_js
    assert 'id="effectStyle"' in html
    assert 'id="showTrajectory"' in html
    assert 'id="showImpact"' in html
    assert "getEffectSettings" in app_js
    assert 'id="importProjectBtn"' in html
    assert 'id="projectInput"' in html
    assert "importProjectFile" in app_js
    assert 'id="shotMap"' in html
    assert "renderShotMap" in app_js
    assert "locateShotMapEvent" in app_js
    assert 'id="analysisPreset"' in html
    assert "analysisPreset" in app_js
    assert 'id="markCutStartBtn"' in html
    assert 'id="finishCutBtn"' in html
    assert "finishManualCut" in app_js
    assert "rebuildSegmentsFromCuts" in app_js
    assert "shotType" in app_js
    assert "getShotTypeLabel" in app_js
    assert "教练备注" in app_js
    assert "checkLocalAnalyzerEnvironment" in app_js
    assert "/api/system" in app_js
    print("Frontend timeline playhead contract passed.")


if __name__ == "__main__":
    run()
