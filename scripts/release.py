import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_SOURCE = ROOT / "extension" / "rivers.js"
DIST_FILE = ROOT / "dist" / "rivers.js"
MANIFEST_FILE = ROOT / "version.json"
VERSION_PATTERN = re.compile(r'const CURRENT_VERSION = "[^"]*";')


def bump_extension_version(version: str) -> str:
    source = EXTENSION_SOURCE.read_text(encoding="utf-8")
    updated, count = VERSION_PATTERN.subn(f'const CURRENT_VERSION = "{version}";', source, count=1)
    if count != 1:
        raise RuntimeError("не нашёл строку const CURRENT_VERSION в extension/rivers.js")
    EXTENSION_SOURCE.write_text(updated, encoding="utf-8", newline="\n")
    return updated


def main() -> int:
    if len(sys.argv) != 2:
        print("использование: python scripts/release.py <версия>, например 1.0.1")
        return 1

    version = sys.argv[1]

    updated_source = bump_extension_version(version)
    DIST_FILE.write_text(updated_source, encoding="utf-8", newline="\n")

    digest = hashlib.sha256(DIST_FILE.read_bytes()).hexdigest()

    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    manifest["version"] = version
    manifest["sha256"] = digest
    MANIFEST_FILE.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )

    print(f"версия {version}, sha256 {digest}")
    print("осталось закоммитить и запушить")
    return 0


if __name__ == "__main__":
    sys.exit(main())
