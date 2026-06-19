import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run():
    html = (ROOT / "app" / "index.html").read_text(encoding="utf-8")
    app_js = (ROOT / "app" / "app.js").read_text(encoding="utf-8")

    html_ids = re.findall(r'\bid="([^"]+)"', html)
    duplicate_ids = sorted(
        name for name, count in Counter(html_ids).items() if count > 1
    )
    assert not duplicate_ids, f"duplicate HTML ids: {duplicate_ids}"

    dynamic_ids = set(re.findall(r'\.id\s*=\s*"([^"]+)"', app_js))
    referenced_ids = set(re.findall(r'\$\("([^"]+)"\)', app_js))
    missing_ids = sorted(referenced_ids - set(html_ids) - dynamic_ids)
    assert not missing_ids, f"app.js references missing HTML ids: {missing_ids}"

    script_sources = re.findall(r'<script\s+src="([^"]+)"', html)
    missing_scripts = sorted(
        source
        for source in script_sources
        if not (ROOT / "app" / source.removeprefix("./")).exists()
    )
    assert not missing_scripts, f"missing frontend scripts: {missing_scripts}"

    print(
        f"DOM bindings passed: {len(html_ids)} ids, "
        f"{len(referenced_ids)} referenced, {len(dynamic_ids)} dynamic, "
        f"{len(script_sources)} scripts."
    )


if __name__ == "__main__":
    run()
