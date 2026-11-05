import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

MANIFEST_URL = "https://raw.githubusercontent.com/USER/REPO/main/version.json"
EXTENSION_FILENAME = "rivers.js"
REQUEST_TIMEOUT_SECONDS = 15

APP_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "spicetify-updater"
LOG_FILE = APP_DATA_DIR / "updater.log"
STATE_FILE = APP_DATA_DIR / "state.json"

EXTENSIONS_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "spicetify" / "Extensions"


def setup_logging() -> None:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=LOG_FILE,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )


def parse_version(version: str) -> tuple:
    parts = []
    for chunk in version.strip().split("."):
        digits = "".join(ch for ch in chunk if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def load_installed_version() -> str:
    if not STATE_FILE.exists():
        return "0.0.0"
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return str(data.get("installed_version", "0.0.0"))
    except (json.JSONDecodeError, OSError):
        return "0.0.0"


def save_installed_version(version: str) -> None:
    STATE_FILE.write_text(json.dumps({"installed_version": version}), encoding="utf-8")


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "spicetify-rivers-updater"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "spicetify-rivers-updater"})
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return response.read()


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(destination: Path, data: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=destination.parent, prefix=".rivers-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as tmp_file:
            tmp_file.write(data)
        os.replace(tmp_path, destination)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def run_spicetify_apply() -> None:
    result = subprocess.run(
        "spicetify apply",
        shell=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"spicetify apply завершился с кодом {result.returncode}: {result.stderr.strip()}")
    logging.info("spicetify apply: %s", result.stdout.strip())


def main() -> int:
    setup_logging()
    logging.info("Запуск апдейтера")

    try:
        manifest = fetch_json(MANIFEST_URL)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        logging.error("Не удалось скачать манифест: %s", error)
        return 1
    except json.JSONDecodeError as error:
        logging.error("Манифест повреждён: %s", error)
        return 1

    remote_version = str(manifest.get("version", ""))
    download_url = manifest.get("url")
    expected_sha256 = str(manifest.get("sha256", "")).lower()

    if not remote_version or not download_url or not expected_sha256:
        logging.error("Манифест неполный: %s", manifest)
        return 1

    installed_version = load_installed_version()
    if parse_version(remote_version) <= parse_version(installed_version):
        logging.info(
            "Версия %s не новее установленной %s, обновление не требуется",
            remote_version,
            installed_version,
        )
        return 0

    logging.info("Найдена новая версия %s (установлена %s)", remote_version, installed_version)

    try:
        payload = fetch_bytes(download_url)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        logging.error("Не удалось скачать файл расширения: %s", error)
        return 1

    actual_sha256 = sha256_of(payload)
    if actual_sha256 != expected_sha256:
        logging.error(
            "Хеш не совпадает, обновление отменено (ожидали %s, получили %s)",
            expected_sha256,
            actual_sha256,
        )
        return 1

    destination = EXTENSIONS_DIR / EXTENSION_FILENAME
    try:
        atomic_write(destination, payload)
    except OSError as error:
        logging.error("Не удалось записать файл расширения: %s", error)
        return 1

    try:
        run_spicetify_apply()
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        logging.error("spicetify apply не выполнился: %s", error)
        return 1

    save_installed_version(remote_version)
    logging.info("Обновлено до версии %s", remote_version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
