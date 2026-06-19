from pathlib import Path

import cv2
import numpy


ROOT = Path(__file__).resolve().parents[1]


def run():
    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    setup_script = (ROOT / "setup-jianqiu.cmd").read_text(encoding="utf-8")
    setup_power_shell = (ROOT / "setup-jianqiu.ps1").read_text(encoding="utf-8")
    start_script = (ROOT / "start-jianqiu.cmd").read_text(encoding="utf-8")
    stop_script = (ROOT / "stop-jianqiu.cmd").read_text(encoding="utf-8")
    background_start_script = (ROOT / "start-jianqiu.ps1").read_text(encoding="utf-8")
    watchdog_script = (ROOT / "run-jianqiu-service.ps1").read_text(encoding="utf-8")
    test_runner = (ROOT / "tests" / "run_all.py").read_text(encoding="utf-8")
    assert "opencv-python" in requirements
    assert "numpy" in requirements
    assert "setup-jianqiu.ps1" in setup_script
    assert "pip install -r" in setup_power_shell
    assert "Node.js 18" in setup_power_shell
    assert "Python 3.10" in setup_power_shell
    assert "node --check" in setup_power_shell
    assert "foreach ($scriptPath" in setup_power_shell
    assert "Application script verification failed: $scriptPath" in setup_power_shell
    assert "start-jianqiu.ps1" in start_script
    assert "stop-jianqiu.ps1" in stop_script
    assert "import cv2,numpy" in background_start_script
    assert "Start-Process" in background_start_script
    assert "-WindowStyle Hidden" in background_start_script
    assert "expectedVersion" in background_start_script
    assert '$expectedVersion = "0.4.3"' in background_start_script
    assert "LOCALAPPDATA" in background_start_script
    assert "run-jianqiu-service.ps1" in background_start_script
    assert "run-jianqiu-service\\.ps1" in background_start_script
    assert "node.WaitForExit()" in watchdog_script
    assert "restarting" in watchdog_script
    assert "MyInvocation.MyCommand.Path" in watchdog_script
    assert "subprocess.TimeoutExpired" in test_runner
    assert "timeout=timeout" in test_runner
    assert "test_dom_bindings.py" in test_runner
    print(f"Environment ready: OpenCV {cv2.__version__}, NumPy {numpy.__version__}")


if __name__ == "__main__":
    run()
