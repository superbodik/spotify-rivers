import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION_SOURCE = ROOT / "extension" / "rivers.js"
DIST_FILE = ROOT / "dist" / "rivers.js"
MANIFEST_FILE = ROOT / "version.json"
UPDATER_SOURCE = ROOT / "updater" / "spicetify_updater.py"
CUSTOM_APP_NAME = "moya-volna"
CUSTOM_APP_SOURCE = ROOT / "custom-app" / CUSTOM_APP_NAME

PLACEHOLDER = "USER/REPO"
SPICETIFY_INSTALL_URL = "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1"
TASK_NAME = "SpotifyRiversUpdater"


def find_spicetify() -> str:
    found = shutil.which("spicetify")
    if found:
        return found
    candidate = Path(os.environ.get("LOCALAPPDATA", "")) / "spicetify" / "spicetify.exe"
    if candidate.exists():
        return str(candidate)
    return ""


def install_spicetify() -> str:
    print("Spicetify не найден, ставлю через официальный установщик")
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            f"iwr -useb {SPICETIFY_INSTALL_URL} | iex",
        ],
        check=True,
    )
    found = find_spicetify()
    if not found:
        raise RuntimeError("установщик отработал, но spicetify.exe не нашёлся")
    return found


def sync_dist_and_hash() -> str:
    source_text = EXTENSION_SOURCE.read_text(encoding="utf-8")
    DIST_FILE.write_text(source_text, encoding="utf-8", newline="\n")
    digest = hashlib.sha256(DIST_FILE.read_bytes()).hexdigest()
    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    manifest["sha256"] = digest
    MANIFEST_FILE.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"dist/rivers.js пересобран, sha256 {digest}")
    return digest


def replace_repo_placeholder(github_repo: str) -> None:
    for path in (EXTENSION_SOURCE, UPDATER_SOURCE):
        text = path.read_text(encoding="utf-8")
        if PLACEHOLDER not in text:
            continue
        path.write_text(text.replace(PLACEHOLDER, github_repo), encoding="utf-8", newline="\n")
        print(f"подставил {github_repo} в {path.relative_to(ROOT)}")

    manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    if PLACEHOLDER in manifest.get("url", ""):
        manifest["url"] = manifest["url"].replace(PLACEHOLDER, github_repo)
        MANIFEST_FILE.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
        print(f"подставил {github_repo} в version.json")

    sync_dist_and_hash()


def enable_extension(spicetify_exe: str) -> None:
    extensions_dir = Path(os.environ["LOCALAPPDATA"]) / "spicetify" / "Extensions"
    extensions_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(EXTENSION_SOURCE, extensions_dir / "rivers.js")
    print(f"скопировал rivers.js в {extensions_dir}")

    subprocess.run([spicetify_exe, "config", "extensions", "rivers.js"], check=True)

    custom_apps_dir = Path(os.environ["LOCALAPPDATA"]) / "spicetify" / "CustomApps" / CUSTOM_APP_NAME
    custom_apps_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(CUSTOM_APP_SOURCE / "manifest.json", custom_apps_dir / "manifest.json")
    shutil.copyfile(CUSTOM_APP_SOURCE / "index.js", custom_apps_dir / "index.js")
    print(f"скопировал custom app 'Моя волна' в {custom_apps_dir}")
    subprocess.run([spicetify_exe, "config", "custom_apps", CUSTOM_APP_NAME], check=True)

    subprocess.run([spicetify_exe, "config", "always_enable_devtools", "1"], check=True)

    subprocess.run([spicetify_exe, "apply"], check=True)
    print("расширение и custom app подключены, spicetify apply выполнен")


def build_updater_exe() -> Path:
    dist_dir = ROOT / "dist"
    build_dir = ROOT / "build"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--onefile",
            "--noconsole",
            "--distpath",
            str(dist_dir),
            "--workpath",
            str(build_dir),
            "--specpath",
            str(build_dir),
            str(UPDATER_SOURCE),
        ],
        check=True,
        cwd=ROOT,
    )
    exe_path = dist_dir / "spicetify_updater.exe"
    if not exe_path.exists():
        raise RuntimeError("PyInstaller отработал, но exe не нашёлся")
    print(f"собран {exe_path}")
    return exe_path


def register_scheduled_task(exe_path: Path) -> None:
    subprocess.run(
        [
            "schtasks",
            "/create",
            "/tn",
            TASK_NAME,
            "/tr",
            str(exe_path),
            "/sc",
            "onlogon",
            "/rl",
            "limited",
            "/f",
        ],
        check=True,
    )
    print(f"задача в Планировщике '{TASK_NAME}' создана, запуск при входе в Windows")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-repo", help="например vedmidbogdan/spotify-rivers")
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--skip-apply", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--skip-task", action="store_true")
    args = parser.parse_args()

    if args.github_repo:
        replace_repo_placeholder(args.github_repo)
    else:
        print(f"--github-repo не передан, {PLACEHOLDER} остался как есть — апдейтер работать не будет")

    spicetify_exe = find_spicetify()
    if not spicetify_exe and not args.skip_install:
        spicetify_exe = install_spicetify()
    elif spicetify_exe:
        print(f"Spicetify уже установлен: {spicetify_exe}")
    else:
        print("Spicetify не найден, пропускаю config/apply")

    if spicetify_exe and not args.skip_apply:
        enable_extension(spicetify_exe)

    exe_path = None
    if not args.skip_build:
        exe_path = build_updater_exe()

    if exe_path and not args.skip_task:
        register_scheduled_task(exe_path)

    print("готово")
    return 0


if __name__ == "__main__":
    sys.exit(main())
