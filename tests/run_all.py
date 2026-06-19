import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = [
    [sys.executable, str(ROOT / "tests" / "test_analyzer.py")],
    [sys.executable, str(ROOT / "tests" / "test_api.py")],
    [sys.executable, str(ROOT / "tests" / "test_frontend_contract.py")],
    [sys.executable, str(ROOT / "tests" / "test_environment.py")],
    ["node", str(ROOT / "tests" / "test_edit_formats.js")],
    ["node", str(ROOT / "tests" / "test_highlight_selection.js")],
    ["node", str(ROOT / "tests" / "test_export_readiness.js")],
    ["node", str(ROOT / "tests" / "test_review_metrics.js")],
    ["node", "--check", str(ROOT / "app" / "app.js")],
    ["node", "--check", str(ROOT / "app" / "edit-formats.js")],
    ["node", "--check", str(ROOT / "app" / "highlight-selection.js")],
    ["node", "--check", str(ROOT / "app" / "export-readiness.js")],
    ["node", "--check", str(ROOT / "app" / "review-metrics.js")],
    ["node", "--check", str(ROOT / "app" / "server.js")],
]


def main():
    for command in COMMANDS:
        print(f"\n> {' '.join(command)}")
        subprocess.run(command, cwd=ROOT, check=True)
    print("\nAll Jianqiu tests passed.")


if __name__ == "__main__":
    main()
