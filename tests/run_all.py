import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = [
    ([sys.executable, "-u", str(ROOT / "tests" / "test_analyzer.py")], 120),
    ([sys.executable, "-u", str(ROOT / "tests" / "test_api.py")], 180),
    ([sys.executable, "-u", str(ROOT / "tests" / "test_frontend_contract.py")], 30),
    ([sys.executable, "-u", str(ROOT / "tests" / "test_environment.py")], 30),
    (["node", str(ROOT / "tests" / "test_edit_formats.js")], 30),
    (["node", str(ROOT / "tests" / "test_highlight_selection.js")], 30),
    (["node", str(ROOT / "tests" / "test_export_readiness.js")], 30),
    (["node", str(ROOT / "tests" / "test_review_metrics.js")], 30),
    (["node", str(ROOT / "tests" / "test_annotation_export.js")], 30),
    (["node", str(ROOT / "tests" / "test_cut_review.js")], 30),
    (["node", str(ROOT / "tests" / "test_file_fingerprint.js")], 30),
    (["node", "--check", str(ROOT / "app" / "app.js")], 30),
    (["node", "--check", str(ROOT / "app" / "edit-formats.js")], 30),
    (["node", "--check", str(ROOT / "app" / "highlight-selection.js")], 30),
    (["node", "--check", str(ROOT / "app" / "export-readiness.js")], 30),
    (["node", "--check", str(ROOT / "app" / "review-metrics.js")], 30),
    (["node", "--check", str(ROOT / "app" / "annotation-export.js")], 30),
    (["node", "--check", str(ROOT / "app" / "cut-review.js")], 30),
    (["node", "--check", str(ROOT / "app" / "file-fingerprint.js")], 30),
    (["node", "--check", str(ROOT / "app" / "server.js")], 30),
]


def main():
    for command, timeout in COMMANDS:
        print(f"\n> {' '.join(command)}", flush=True)
        try:
            subprocess.run(command, cwd=ROOT, check=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            raise SystemExit(
                f"Test timed out after {timeout}s: {' '.join(error.cmd)}"
            ) from error
    print("\nAll Jianqiu tests passed.")


if __name__ == "__main__":
    main()
