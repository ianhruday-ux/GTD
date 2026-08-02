#!/usr/bin/env python3
"""Build dist/, wrap it, and put it on the connected Android phone.

    python tools_pushphone.py            # build -> sync -> APK -> install
    python tools_pushphone.py --no-build # skip build.py (dist/ already current)

WHY THIS EXISTS AS A SCRIPT rather than four commands in a session:

`assembleRelease` packages whatever is already sitting in
android/app/src/main/assets/public/, which ONLY updates on an explicit
`npx cap sync android`. It does not happen automatically and does not know
dist/index.html was rebuilt since the last one. A build can succeed, install
cleanly, and launch fine while silently running app code from hours earlier --
which cost a full round of confused troubleshooting during W5
(wrapper-plan.md §6, trap 9).

WHAT CHANGED IN W7 ITEM 3, and why this file got shorter: it used to build a
DEBUG APK and carry its own copy of the sync-then-verify chain. Both are now
wrong.

  * Wrong build. Android identifies an app by its signing certificate, and the
    shipping APK is signed with the real release key (wrapper/android/
    keystore.properties). A debug APK is signed with the universal Android
    debug key, so the two cannot replace each other -- `adb install` fails with
    INSTALL_FAILED_UPDATE_INCOMPATIBLE and the only way through is uninstalling,
    which takes the phone's local data with it. The author's phone runs the
    release build, the same one their friends run. This script has to produce
    THAT.

  * Wrong copy. tools_package.py already builds and verifies exactly that APK --
    cap sync, byte-compare the staged assets, assembleRelease with the OneDrive
    retry, then four assertions against the finished artifact (payload matches
    dist/, signed by the release key, not debuggable, App Key compiled in). A
    second implementation of the same chain is a second thing to keep correct,
    and the half that drifts is the half nobody is looking at.

So this script is now what it always should have been: the packaging chain,
plus the one thing packaging does not do -- put it on the phone in front of you.
"""
import os
import subprocess
import shutil
import sys
from pathlib import Path

import tools_package as pkg

REPO = Path(__file__).resolve().parent
PACKAGE = "com.ianhruday.oela"


def find_adb(android_home):
    if not android_home:
        return shutil.which("adb")
    exe = "adb.exe" if os.name == "nt" else "adb"
    p = Path(android_home) / "platform-tools" / exe
    return str(p) if p.exists() else shutil.which("adb")


def install(adb, apk):
    r = subprocess.run([adb, "install", "-r", str(apk)],
                       capture_output=True, text=True)
    out = (r.stdout or "") + (r.stderr or "")

    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in out or "signatures do not match" in out:
        sys.exit(
            "\ntools_pushphone: the phone already has an OELA signed with a DIFFERENT key.\n"
            "  Almost certainly an old debug build from before W7 item 3.\n"
            "  Android will not let one replace the other, on purpose -- a matching\n"
            "  signature is how it knows an update came from the same author.\n"
            "\n"
            "  To move across, ON THE PHONE:\n"
            "    1. Open OELA -> the ... menu -> Export a backup, and keep the file.\n"
            "       (Or just confirm the phone has synced, if Dropbox is connected --\n"
            "       a fresh install rejoins additive-only and pulls everything back.)\n"
            "    2. Uninstall OELA. Android deletes its data with it.\n"
            "    3. Run this script again.\n"
            "  This is a one-time move. Every build after it installs straight over."
        )

    if r.returncode != 0 or "Success" not in out:
        sys.stdout.write(out[-3000:])
        sys.exit("\ntools_pushphone: FAILED -> adb install")

    print("installed")


def main():
    args = set(sys.argv[1:])
    unknown = args - {"--no-build"}
    if unknown:
        sys.exit(f"tools_pushphone: unknown option(s): {' '.join(sorted(unknown))}")

    # Preconditions before any work: the toolchain, the signing key, and the
    # phone. Everything below is minutes, and discovering the phone is unplugged
    # at the end of it is the wrong order.
    java_home, android_home = pkg.preflight_android()
    adb = find_adb(android_home)
    if not adb:
        sys.exit("tools_pushphone: adb not found.")

    devices = subprocess.run([adb, "devices"], capture_output=True, text=True).stdout
    attached = [l.split("\t")[0] for l in devices.splitlines()[1:] if "\tdevice" in l]
    if not attached:
        sys.exit("tools_pushphone: no phone connected (adb sees nothing).\n"
                 "  Plug it in, enable USB debugging, and tap Allow.\n"
                 "  If Windows still cannot see it, install Samsung's own USB driver:\n"
                 "  https://developer.samsung.com/android-usb-driver")
    print(f"phone: {attached[0]}")

    if "--no-build" not in args:
        pkg.build_web()
    elif not pkg.DIST_INDEX.exists():
        sys.exit("tools_pushphone: --no-build, but dist/index.html does not exist.")

    # build_apk() drops a copy in release/ as a side effect, which is wanted:
    # the APK on the phone and the one you would hand somebody are then the
    # same file, not two builds that merely came from the same source.
    pkg.RELEASE.mkdir(exist_ok=True)
    version = pkg.version_name()
    apk = pkg.build_apk(version, java_home, android_home, allow_missing_key=False)

    print("installing...")
    install(adb, apk)
    print("\nthe phone is now running the current build.")


if __name__ == "__main__":
    main()
