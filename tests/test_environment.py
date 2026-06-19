from pathlib import Path

import cv2
import numpy


ROOT = Path(__file__).resolve().parents[1]


def run():
    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    setup_script = (ROOT / "setup-jianqiu.cmd").read_text(encoding="utf-8")
    start_script = (ROOT / "start-jianqiu.cmd").read_text(encoding="utf-8")
    background_start_script = (ROOT / "start-jianqiu.ps1").read_text(encoding="utf-8")
    assert "opencv-python" in requirements
    assert "numpy" in requirements
    assert "pip install -r requirements.txt" in setup_script
    assert "start-jianqiu.ps1" in start_script
    assert "import cv2,numpy" in background_start_script
    assert "Start-Process" in background_start_script
    assert "-WindowStyle Hidden" in background_start_script
    assert "expectedVersion" in background_start_script
    assert "LOCALAPPDATA" in background_start_script
    print(f"Environment ready: OpenCV {cv2.__version__}, NumPy {numpy.__version__}")


if __name__ == "__main__":
    run()
