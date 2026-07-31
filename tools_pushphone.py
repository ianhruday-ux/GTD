#!/usr/bin/env python3
"""Build dist/, wrap it, and put it on the connected Android phone.

    python tools_pushphone.py            # build -> sync -> APK -> install
    python tools_pushphone.py --no-build # skip build.py (dist/ already current)

WHY THIS EXISTS AS A SCRIPT rather than four commands in a session:

`assembleDebug` packages whatever is already sitting in
android/app/src/main/assets/public/, which ONLY updates on an explicit
`npx cap sync android`. It does not happen automatically and does not know
dist/index.html was rebuilt since the last one. A build can succeed, install
cleanly, and launch fine while silently running app code from hours earlier --
which cost a full round of confused troubleshooting during W5
(wrapper-plan.md §6, trap 9).

So this script does the whole chain in the right order, every time, and then
VERIFIES it rather than trusting it: after the sync it compares the bytes
Capacitor copied against dist/index.html, and refuses to build an APK if they
differ. The trap is not "someone forgets a command" -- it is "the failure is
silent", so the fix has to be a check, not a reminder.

Also pins down JAVA_HOME / ANDROID_HOME, which Gradle needs and which are not
set globally on this machine.
"""
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
WRAPPER = REPO / "wrapper"
ANDROID = WRAPPER / "android"
DIST_INDEX = REPO / "dist" / "index.html"
SYNCED_INDEX = ANDROID / "app" / "src" / "main" / "assets" / "public" / "index.html"
APK = ANDROID / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
PACKAGE = "com.ianhruday.oela"


def first_existing(paths):
    for p in paths:
        if p and Path(p).exists():
            return str(p)
    return None


def find_java_home():
    """Android Studio ships a JDK (jbr). Nothing sets JAVA_HOME globally here."""
    return os.environ.get("JAVA_HOME") or first_existing([
        Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Android/Android Studio/jbr",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Android Studio/jbr",
        "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    ])


def find_android_home():
    return os.environ.get("ANDROID_HOME") or first_existing([
        Path(os.environ.get("LOCALAPPDATA", "")) / "Android/Sdk",
        Path.home() / "Android/Sdk",
        Path.home() / "Library/Android/sdk",
    ])


def find_adb(android_home):
    if not android_home:
        return shutil.which("adb")
    exe = "adb.exe" if os.name == "nt" else "adb"
    p = Path(android_home) / "platform-tools" / exe
    return str(p) if p.exists() else shutil.which("adb")


def run(cmd, cwd, env=None, shell=False):
    r = subprocess.run(cmd, cwd=str(cwd), env=env, shell=shell,
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stdout.write(r.stdout[-3000:])
        sys.stderr.write(r.stderr[-3000:])
        sys.exit(f"\ntools_pushphone: FAILED -> {cmd if isinstance(cmd, str) else ' '.join(map(str, cmd))}")
    return r.stdout


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    java_home = find_java_home()
    android_home = find_android_home()
    adb = find_adb(android_home)

    if not java_home:
        sys.exit("tools_pushphone: no JDK found. Install Android Studio, or set JAVA_HOME.")
    if not android_home:
        sys.exit("tools_pushphone: no Android SDK found. Set ANDROID_HOME.")
    if not adb:
        sys.exit("tools_pushphone: adb not found.")

    # Device check FIRST -- everything below is minutes of work, and doing it
    # only to discover the phone is unplugged is the wrong order.
    devices = subprocess.run([adb, "devices"], capture_output=True, text=True).stdout
    attached = [l.split("\t")[0] for l in devices.splitlines()[1:] if "\tdevice" in l]
    if not attached:
        sys.exit("tools_pushphone: no phone connected (adb sees nothing).\n"
                 "  Plug it in, enable USB debugging, and tap Allow.\n"
                 "  If Windows still cannot see it, install Samsung's own USB driver:\n"
                 "  https://developer.samsung.com/android-usb-driver")
    print(f"phone: {attached[0]}")

    if "--no-build" not in sys.argv:
        print(run([sys.executable, "build.py"], cwd=REPO).strip())

    npx = "npx.cmd" if os.name == "nt" else "npx"
    print("syncing web assets into the Android project...")
    run([npx, "cap", "sync", "android"], cwd=WRAPPER)

    # THE CHECK THIS SCRIPT EXISTS FOR. If these differ, the APK would ship
    # code that is not what dist/ holds -- silently, and it would launch fine.
    if not SYNCED_INDEX.exists():
        sys.exit(f"tools_pushphone: {SYNCED_INDEX} missing after cap sync — sync did not copy anything.")
    if sha(SYNCED_INDEX) != sha(DIST_INDEX):
        sys.exit("tools_pushphone: the synced assets do NOT match dist/index.html.\n"
                 "  Refusing to build a stale APK (wrapper-plan.md §6, trap 9).")
    print("verified: packaged assets are byte-identical to dist/index.html")

    env = dict(os.environ, JAVA_HOME=java_home, ANDROID_HOME=android_home)
    gradlew = str(ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew"))
    print("building the APK...")
    run([gradlew, "assembleDebug"], cwd=ANDROID, env=env)

    print("installing...")
    out = run([adb, "install", "-r", str(APK)], cwd=REPO)
    print(out.strip().splitlines()[-1] if out.strip() else "installed")
    print("\nthe phone is now running the current build.")


if __name__ == "__main__":
    main()
