#!/usr/bin/env python3
"""Produce everything a person needs to install OELA, into release/.

    python tools_package.py              # web file + APK + desktop build
    python tools_package.py --no-build   # skip build.py (dist/ already current)
    python tools_package.py --android    # only the APK
    python tools_package.py --desktop    # only the Windows desktop build
    python tools_package.py --web        # only the standalone HTML file

This is W7 item 3 (wrapper-plan.md): the last chunk of the wrapper round.
Three ways to install one product, from one build of one payload.

WHY THIS IS A SCRIPT AND NOT A LIST OF COMMANDS -- the same argument
tools_pushphone.py makes, one step further. That script exists because
`assembleDebug` silently packages whatever is already sitting in
android/app/src/main/assets/public/, which only ever updates on an explicit
`npx cap sync android` (wrapper-plan.md §6, trap 9). A stale APK builds
cleanly, installs cleanly, launches fine, and runs code from hours ago.

Handing that APK to somebody else raises the cost of the same mistake: they
cannot tell, you cannot tell, and the only symptom is a bug you already fixed.
So this script does not merely run the steps in the right order -- it VERIFIES
the artifact after the fact, by opening the finished APK as a zip and comparing
the index.html actually inside it against dist/index.html byte for byte. The
staging check tools_pushphone.py performs can in principle be defeated by a
Gradle cache; reading the shipped file cannot.

It checks four things about the APK before calling it done:

  1. the payload inside the APK is byte-identical to dist/index.html
  2. it is signed, and by the release key rather than the universal debug key
  3. android:debuggable is not set
  4. the Dropbox App Key was actually compiled in (an APK whose Connect
     Dropbox button rejects every attempt is the same silent-failure shape)
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent
WRAPPER = REPO / "wrapper"
ANDROID = WRAPPER / "android"
ELECTRON = WRAPPER / "electron"
DIST = REPO / "dist"
DIST_INDEX = DIST / "index.html"
RELEASE = REPO / "release"

# Scratch space, deliberately OUTSIDE the repo -- which is to say outside
# OneDrive. Staging the desktop build unpacks ~300 MB of Electron, and the
# first version of this script put that inside the synced folder: OneDrive
# immediately began uploading it, took handles on thousands of files, and
# Gradle then failed to delete its own intermediates ("Unable to delete
# directory", "EBUSY") on the very next run. That is the W2 collision again,
# except this script was CAUSING it rather than merely suffering it. Nothing
# here is worth syncing, backing up, or keeping between runs.
BUILD_TMP = Path(
    os.environ.get("OELA_BUILD_TMP")
    or (Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "oela-build")
)

SYNCED_INDEX = ANDROID / "app" / "src" / "main" / "assets" / "public" / "index.html"
RELEASE_APK = ANDROID / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
KEYSTORE_PROPS = ANDROID / "keystore.properties"
SECRETS = ANDROID / "secrets.properties"
INSTALL_DOC = REPO / "INSTALL.md"

# The APK's own copy of the payload. Capacitor puts webDir under assets/public/.
APK_PAYLOAD_ENTRY = "assets/public/index.html"

# The Electron shell's own source. main.js require()s the others, so a missing
# one is a crash at launch that nothing before launch would notice.
SHELL_FILES = ["main.js", "preload.js", "syncPath.js"]


# ---------------------------------------------------------------- environment

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


def find_build_tool(android_home, *names):
    """Newest build-tools version wins; the tools here are backward compatible."""
    if not android_home:
        return None
    root = Path(android_home) / "build-tools"
    if not root.exists():
        return None
    for version in sorted((d for d in root.iterdir() if d.is_dir()),
                          key=lambda d: d.name, reverse=True):
        for name in names:
            candidate = version / name
            if candidate.exists():
                return str(candidate)
    return None


def run(cmd, cwd, env=None, capture=True):
    r = subprocess.run(cmd, cwd=str(cwd), env=env,
                       capture_output=capture, text=True)
    if r.returncode != 0:
        if capture:
            sys.stdout.write(r.stdout[-4000:])
            sys.stderr.write(r.stderr[-4000:])
        shown = cmd if isinstance(cmd, str) else " ".join(map(str, cmd))
        sys.exit(f"\ntools_package: FAILED -> {shown}")
    return r.stdout if capture else ""


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def version_name():
    """Single source of truth is app/build.gradle, the same value Android shows."""
    gradle = (ANDROID / "app" / "build.gradle").read_text(encoding="utf-8")
    m = re.search(r'versionName\s+"([^"]+)"', gradle)
    return m.group(1) if m else "1.0"


# ------------------------------------------------------------------- payload

def build_web():
    print(run([sys.executable, "build.py"], cwd=REPO).strip())


def stage_web(version):
    """The zero-install option, and the one that needs no permission from anyone.

    dist/index.html is already self-contained -- fonts inlined, no CDN, no
    service worker needed to open it (swClient.js skips registration on file:).
    Renaming it is the whole packaging step: 'index.html' in a downloads folder
    tells you nothing about what it is.
    """
    out = RELEASE / f"OELA-{version}.html"
    shutil.copy2(DIST_INDEX, out)
    print(f"  web      {out.name}  ({out.stat().st_size / 1_048_576:.2f} MB)")
    return out


# ------------------------------------------------------------------- android

def preflight_android():
    java_home = find_java_home()
    android_home = find_android_home()
    if not java_home:
        sys.exit("tools_package: no JDK found. Install Android Studio, or set JAVA_HOME.")
    if not android_home:
        sys.exit("tools_package: no Android SDK found. Set ANDROID_HOME.")
    if not KEYSTORE_PROPS.exists():
        sys.exit(
            "tools_package: wrapper/android/keystore.properties is missing.\n"
            "  A release APK has to be signed with a stable private key -- Android\n"
            "  identifies the app by that certificate, so a build signed with a\n"
            "  different one cannot install over an installed OELA.\n"
            "  If you still have release.keystore, write keystore.properties beside\n"
            "  it (storeFile / storePassword / keyAlias / keyPassword).\n"
            "  If you have lost it, see INSTALL.md -- everyone must uninstall first."
        )
    props = dict(
        line.split("=", 1) for line in
        (l.strip() for l in KEYSTORE_PROPS.read_text(encoding="utf-8").splitlines())
        if line and not line.startswith("#") and "=" in line
    )
    store = ANDROID / props.get("storeFile", "release.keystore")
    if not store.exists():
        sys.exit(f"tools_package: keystore.properties points at {store}, which does not exist.")
    return java_home, android_home


def dropbox_app_key():
    if not SECRETS.exists():
        return ""
    for line in SECRETS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("dropboxAppKey"):
            return line.split("=", 1)[1].strip() if "=" in line else ""
    return ""


def build_apk(version, java_home, android_home, allow_missing_key, dest_dir=RELEASE):
    """dest_dir exists so that NOT every APK build lands in release/.

    ⚑ release/ is the publication staging area: CHECKSUMS.txt describes it, and
    RELEASE-NOTES publishes those hashes for people to verify against. A build
    that is merely on its way to the phone is not a release artifact, but it
    carries the same versionName and therefore the same filename -- so writing
    it here silently replaced the local copy of a PUBLISHED artifact with a
    different build wearing its name. Hit on 2026-08-05: release/OELA-1.0.apk
    stopped matching both CHECKSUMS.txt and the asset on GitHub, and the folder
    became a mix of published and not, with nothing on its face to say which was
    which. Only tools_package.py -- the deliberate act of packaging -- passes
    the default now.
    """
    key = dropbox_app_key()
    if not key and not allow_missing_key:
        sys.exit(
            "tools_package: no dropboxAppKey in wrapper/android/secrets.properties.\n"
            "  The App Key is compiled into the APK (BuildConfig.DROPBOX_APP_KEY), so\n"
            "  an APK built without one can never sync -- Connect Dropbox rejects every\n"
            "  attempt, on every device it is installed on, and nothing in the app says\n"
            "  why. That is not a build worth handing to anybody by accident.\n"
            "  Pass --allow-missing-key if a sync-less build is genuinely what you want."
        )

    npx = "npx.cmd" if os.name == "nt" else "npx"
    print("  syncing web assets into the Android project...")
    run_resilient([npx, "cap", "sync", "android"], WRAPPER, None, "npx cap sync android",
                  clear=[WRAPPER / "android" / "capacitor-cordova-android-plugins" / "build"])

    if not SYNCED_INDEX.exists():
        sys.exit(f"tools_package: {SYNCED_INDEX} missing after cap sync -- sync copied nothing.")
    if sha(SYNCED_INDEX) != sha(DIST_INDEX):
        sys.exit("tools_package: synced assets do NOT match dist/index.html.\n"
                 "  Refusing to build a stale APK (wrapper-plan.md §6, trap 9).")

    env = dict(os.environ, JAVA_HOME=java_home, ANDROID_HOME=android_home)
    gradlew = str(ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew"))
    print("  building the signed release APK (this takes a minute)...")
    gradle_release(gradlew, env)

    if not RELEASE_APK.exists():
        sys.exit(f"tools_package: expected an APK at {RELEASE_APK} and there is none.")

    verify_apk(RELEASE_APK, android_home, env, expect_key=bool(key))

    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"OELA-{version}.apk"
    shutil.copy2(RELEASE_APK, out)
    print(f"  android  {out.name}  ({out.stat().st_size / 1_048_576:.2f} MB)")
    return out


# The ways Windows says "somebody else has this file open". This repo lives in
# a OneDrive-synced folder, and OneDrive holds handles on files it is uploading
# -- which, right after a build, is thousands of freshly written intermediates.
# Both Gradle and `cap sync` delete and recreate those directories, so both can
# lose the race. wrapper-plan.md's W2 entry hit the first of these during
# resource merge and set org.gradle.vfs.watch=false, which reduced it without
# removing it, and noted that deleting the build directory clears the rest.
ONEDRIVE_LOCK_SIGNATURES = (
    "Unable to delete directory",
    "EBUSY",
    "resource busy or locked",
    "Access is denied",
    "EPERM",
    # ⚑ The same problem wearing different words. When OneDrive has turned an
    # intermediate into a cloud placeholder rather than merely holding it open,
    # Gradle does not report a lock at all -- it reports that it cannot
    # fingerprint the file:
    #   Cannot snapshot ...\aapt\AndroidManifest.xml: not a regular file
    # Without these two the run exits on the first attempt with no retry, which
    # is exactly the state it is best equipped to recover from. Neither string
    # can come out of a real compile error (they are filesystem-snapshot
    # failures), so admitting them does not blunt the docstring's rule.
    "Cannot snapshot",
    "not a regular file",
)


def run_resilient(cmd, cwd, env, label, clear=()):
    """Run a build command, retrying ONCE past a OneDrive file lock.

    Deliberately not a general retry. The retry fires only when the output
    carries one of the signatures above, and it does the documented remedy --
    delete the intermediates that are stuck -- before trying again, rather than
    running the same command a second time and hoping. Every other failure
    exits on the first attempt with its own output intact.

    That distinction is the whole point: a packaging script that quietly
    retries real compile errors is worse than one that never retries, because
    it turns a clear failure into an intermittent one.
    """
    def attempt():
        return subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True)

    r = attempt()
    if r.returncode == 0:
        return r.stdout
    combined = (r.stdout or "") + (r.stderr or "")
    if not any(sig in combined for sig in ONEDRIVE_LOCK_SIGNATURES):
        sys.stdout.write(combined[-4000:])
        sys.exit(f"\ntools_package: FAILED -> {label}")

    print("    OneDrive was holding build files open; clearing and retrying once")
    for path in clear:
        force_rmtree(path)
    r = attempt()
    if r.returncode != 0:
        sys.stdout.write(((r.stdout or "") + (r.stderr or ""))[-4000:])
        sys.exit(f"\ntools_package: FAILED -> {label} (after clearing build directories)\n"
                 "  Pause OneDrive syncing and run this again. If it still fails,\n"
                 "  delete wrapper/android/app/build and\n"
                 "  wrapper/android/capacitor-cordova-android-plugins/build entirely.")
    return r.stdout


def gradle_release(gradlew, env):
    # ⚑ BOTH directories, and the second one is not optional: the failure that
    # prompted this cleared app/build and then died in
    # capacitor-cordova-android-plugins/build, which the retry had never
    # touched. The exit message below has always named both as the manual
    # remedy -- the automatic recovery was one directory short of its own
    # advice, so the retry could only ever fix half the failures it fired on.
    # Keep this list and that message in step.
    run_resilient([gradlew, "assembleRelease"], ANDROID, env, "gradlew assembleRelease",
                  clear=[ANDROID / "app" / "build",
                         ANDROID / "capacitor-cordova-android-plugins" / "build"])


def verify_apk(apk, android_home, env, expect_key):
    """Four assertions about the finished artifact, not about the build that made it."""
    # 1. The payload actually inside the APK.
    with zipfile.ZipFile(apk) as z:
        try:
            packaged = z.read(APK_PAYLOAD_ENTRY)
        except KeyError:
            sys.exit(f"tools_package: the APK contains no {APK_PAYLOAD_ENTRY}.")
    if hashlib.sha256(packaged).hexdigest() != sha(DIST_INDEX):
        sys.exit("tools_package: the app inside the APK is NOT dist/index.html.\n"
                 "  This is trap 9 surviving the staging check -- do not ship this file.")
    print("    verified: the app inside the APK is byte-identical to dist/index.html")

    # 2. Signed, and not by the debug key. Every debug APK on earth is signed by
    #    "CN=Android Debug", so the check is a name check, not a fingerprint one.
    apksigner = find_build_tool(android_home, "apksigner.bat", "apksigner")
    if not apksigner:
        print("    ⚠ apksigner not found in build-tools; skipped the signature check")
    else:
        out = run([apksigner, "verify", "--print-certs", str(apk)], cwd=REPO, env=env)
        if "CN=Android Debug" in out:
            sys.exit("tools_package: this APK is signed with the DEBUG key.\n"
                     "  assembleRelease fell back to the debug signingConfig, which means\n"
                     "  keystore.properties was not picked up.")
        subject = next((l.strip() for l in out.splitlines() if "certificate DN" in l), "?")
        print(f"    verified: signed by the release key -- {subject}")

    # 3. Not debuggable. Release builds do not set it, but "should not" is not
    #    a check; a stray android:debuggable in the manifest would survive.
    aapt = find_build_tool(android_home, "aapt2.exe", "aapt2", "aapt.exe", "aapt")
    if aapt and "aapt2" in Path(aapt).name:
        badging = run([aapt, "dump", "badging", str(apk)], cwd=REPO, env=env)
    elif aapt:
        badging = run([aapt, "dump", "badging", str(apk)], cwd=REPO, env=env)
    else:
        badging = ""
        print("    ⚠ aapt not found in build-tools; skipped the debuggable check")
    if badging:
        if "application-debuggable" in badging:
            sys.exit("tools_package: this APK is marked debuggable. Not a release build.")
        print("    verified: not debuggable")

    # 4. The Dropbox App Key survived into the binary. BuildConfig compiles it
    #    into classes.dex as a string constant, so its presence is checkable
    #    without unpacking the dex properly.
    if expect_key:
        key = dropbox_app_key().encode("utf-8")
        with zipfile.ZipFile(apk) as z:
            dex_names = [n for n in z.namelist() if n.endswith(".dex")]
            found = any(key in z.read(n) for n in dex_names)
        if not found:
            sys.exit("tools_package: the Dropbox App Key is not in the compiled APK.\n"
                     "  secrets.properties has one, but BuildConfig did not pick it up --\n"
                     "  a stale Gradle build is the usual cause. Try a clean build.")
        print("    verified: the Dropbox App Key is compiled in, so sync can connect")


# ------------------------------------------------------------------- desktop

def make_ico(png, ico, size):
    """A one-image .ico wrapping a PNG (the Vista+ ICO form), so the .exe has an icon.

    Written by hand rather than with Pillow, which is not a dependency of this
    repo and is not worth becoming one for 40 bytes of header. The directory
    entry stores width and height in a single byte each, so 512 is not
    expressible -- hence the 192px source. Windows scales it.
    """
    data = png.read_bytes()
    header = struct.pack("<HHH", 0, 1, 1)                       # reserved, type=icon, count
    entry = struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32,   # w, h, palette, reserved, planes, bpp
                        len(data), 6 + 16)                      # bytes, offset past header+entry
    ico.write_bytes(header + entry + data)


def stage_desktop(version):
    """Lay out exactly what ships, and nothing else.

    The Electron shell in the repo loads ../../dist/index.html on purpose -- it
    wraps the real product rather than a copy that can drift. A packaged app has
    no repo above it, so the payload has to come along; main.js resolves either
    layout (see its own comment). What is staged here is the whole application:
    two small JS files, a package.json, and the payload. Nothing from
    node_modules -- the shell has no runtime dependencies, only Electron itself,
    which the packager supplies.
    """
    stage = BUILD_TMP / "electron-app"
    force_rmtree(stage)
    (stage / "dist").mkdir(parents=True)

    # Every .js the shell is made of. Enumerated rather than globbed on
    # purpose -- a glob would silently start shipping anything that lands in
    # this folder -- but that means a NEW module has to be added here, and
    # forgetting is a crash on require() that only the packaged build shows.
    # verify_desktop() below opens the built app and checks each one arrived.
    for name in SHELL_FILES:
        shutil.copy2(ELECTRON / name, stage / name)
    shutil.copy2(DIST_INDEX, stage / "dist" / "index.html")
    shutil.copy2(DIST / "icon-512.png", stage / "dist" / "icon-512.png")

    # ⚠ "name" MUST stay "oela-electron", matching wrapper/electron/package.json,
    # and there must be no "productName". Electron derives userData -- which is
    # where Chromium puts localStorage, i.e. where every list in the app lives --
    # from app.getName(), which is productName if present and name otherwise. Set
    # productName to "OELA" here and the packaged build would read
    # %APPDATA%/OELA while `npm start` reads %APPDATA%/oela-electron: two
    # installations of the same app that cannot see each other's data, with the
    # packaged one silently starting empty on a machine that already had lists.
    # The exe is still called OELA.exe (electron-packager's --name) and the
    # window is still titled OELA (main.js), so nothing user-visible pays for
    # this; the folder name is internal.
    (stage / "package.json").write_text(json.dumps({
        "name": "oela-electron",
        "version": version,
        "description": "Over-Engineered List App",
        # electron-packager requires author -- it becomes the CompanyName in the
        # .exe's file properties (right-click -> Properties -> Details). Better a
        # name there than a blank.
        #
        # ⚑ CORRECTED (Windows install test, 2026-08-03). This used to claim
        # CompanyName was "what Windows shows in the SmartScreen 'unknown
        # publisher' dialog". It is not, and the test proved it: the shipped exe
        # carries CompanyName "Ian Hruday" and SmartScreen still says Unknown
        # publisher. That dialog reads the AUTHENTICODE SIGNATURE, and an
        # unsigned binary has no publisher identity to show, whatever the version
        # resource says. Nothing here can change it -- only code signing can,
        # which is the certificate INSTALL.md tells testers about. (INSTALL.md
        # itself was right all along; this comment was the wrong one.)
        "author": "Ian Hruday",
        "main": "main.js",
        # No dependencies by design: the shell requires nothing but electron,
        # which is the runtime rather than a package to install.
        "dependencies": {}
    }, indent=2) + "\n", encoding="utf-8")
    return stage


def force_rmtree(folder):
    """shutil.rmtree, but survives this repo living inside a OneDrive folder.

    Same environment interaction wrapper-plan.md already records against Gradle
    (W2's "Unable to delete directory"): OneDrive's sync client opens handles on
    files it is uploading, and a directory cannot be removed while one is held,
    so a plain rmtree fails with WinError 5 at random depending on what OneDrive
    happened to be doing. It is transient -- the handle is released in well under
    a second -- so a few retries turn a hard failure into a pause nobody notices.
    The chmod is for the other cause of the same errno: read-only bits, which
    Electron distributions carry on some files.
    """
    if not folder.exists():
        return
    def on_error(func, path, exc_info):
        try:
            os.chmod(path, 0o700)
            func(path)
        except Exception:
            pass
    for attempt in range(5):
        try:
            shutil.rmtree(folder, onexc=on_error)
        except TypeError:  # onexc is 3.12+; onerror on older interpreters
            shutil.rmtree(folder, onerror=lambda f, p, e: on_error(f, p, e))
        except Exception:
            pass
        if not folder.exists():
            return
        time.sleep(0.5 * (attempt + 1))
    sys.exit(f"tools_package: could not delete {folder}.\n"
             "  Something is holding a file open in it -- OneDrive syncing, or a\n"
             "  packaged OELA still running. Close it and run this again.")


def zip_dir(folder, out):
    """Zip a tree, clamping any timestamp the ZIP format cannot represent.

    Not shutil.make_archive, which is otherwise exactly this and one line: some
    files in an Electron distribution carry a mtime of epoch 0, and the ZIP
    format's date field starts at 1980, so make_archive raises partway through
    and leaves a half-written archive behind. Clamping is the right fix rather
    than the expedient one -- the timestamps inside a redistributable build are
    not information anybody needs, and the alternative (touching every file
    before zipping) rewrites the thing being shipped to satisfy the shipping.
    """
    epoch_1980 = (1980, 1, 1, 0, 0, 0)
    files = sorted(p for p in folder.rglob("*") if p.is_file())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in files:
            arcname = Path(folder.name) / path.relative_to(folder)
            stamp = path.stat().st_mtime
            date_time = time.localtime(stamp)[:6]
            if date_time[0] < 1980:
                date_time = epoch_1980
            info = zipfile.ZipInfo(str(arcname).replace("\\", "/"), date_time)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (path.stat().st_mode & 0xFFFF) << 16
            z.writestr(info, path.read_bytes())


def electron_version():
    """The Electron actually installed here, not the caret range in package.json.

    electron-packager normally infers this from the app's own
    devDependencies.electron -- but the staged app deliberately declares no
    dependencies at all (it has none), so it has to be told. Reading the
    installed package rather than the "^43.2.0" range means the shipped runtime
    is the same one every W6 test ran against, not whatever npm would resolve
    that range to today.
    """
    pkg = ELECTRON / "node_modules" / "electron" / "package.json"
    if not pkg.exists():
        sys.exit("tools_package: electron is not installed.\n"
                 "  Run `npm install` in wrapper/electron first.")
    return json.loads(pkg.read_text(encoding="utf-8"))["version"]


def build_desktop(version):
    stage = stage_desktop(version)
    runtime = electron_version()

    icon = BUILD_TMP / "oela.ico"
    try:
        make_ico(DIST / "icon-192.png", icon, 192)
    except Exception as e:
        print(f"    ⚠ could not build the .ico ({e}); the .exe keeps Electron's own icon")
        icon = None

    out_dir = BUILD_TMP / "packaged"
    force_rmtree(out_dir)

    npx = "npx.cmd" if os.name == "nt" else "npx"
    cmd = [npx, "electron-packager", str(stage), "OELA",
           "--platform=win32", "--arch=x64",
           f"--electron-version={runtime}",
           f"--app-version={version}",
           f"--out={out_dir}", "--overwrite",
           "--prune=false",
           # ⚑ Builder's call: no asar. Packaging the app into a single
           # archive is electron-packager's default and buys two things --
           # fewer files on disk, and a payload that isn't trivially editable.
           # Neither applies here. The whole app is five files, and the one
           # that matters is a self-contained HTML file whose entire design
           # premise is that you can open it in a text editor and read it.
           # Leaving it as a plain folder means the check below can read the
           # shipped index.html directly instead of reaching into an archive
           # to do it -- and a verification you have to unpack something to
           # perform is one that quietly stops being performed.
           "--asar=false"]
    if icon:
        cmd.append(f"--icon={icon}")
    print(f"  packaging the Windows desktop build on Electron {runtime}...")
    run(cmd, cwd=ELECTRON)

    built = next((d for d in out_dir.iterdir() if d.is_dir()), None)
    if not built:
        sys.exit("tools_package: electron-packager produced no output directory.")

    exe = built / "OELA.exe"
    if not exe.exists():
        sys.exit(f"tools_package: no OELA.exe in {built}.")

    # Verify the payload the same way the APK is verified -- the desktop build
    # copies dist/index.html rather than referencing it, so it can go stale in
    # exactly the same silent way.
    app_dir = built / "resources" / "app"
    shipped = app_dir / "dist" / "index.html"
    if not shipped.exists():
        sys.exit(f"tools_package: no payload at {shipped} -- the app was not staged correctly.")
    if sha(shipped) != sha(DIST_INDEX):
        sys.exit("tools_package: the app inside the desktop build is NOT dist/index.html.")
    print("    verified: the app inside the desktop build is byte-identical to dist/index.html")

    # Every module main.js require()s, present in the build. A missing one does
    # not fail the package step -- it fails at launch, on the user's machine,
    # with a dialog they cannot act on.
    missing = [n for n in SHELL_FILES if not (app_dir / n).exists()]
    if missing:
        sys.exit(f"tools_package: the desktop build is missing {', '.join(missing)}.\n"
                 "  Add it to SHELL_FILES -- the packaged app would crash on launch.")
    print(f"    verified: all {len(SHELL_FILES)} shell modules shipped ({', '.join(SHELL_FILES)})")

    out = RELEASE / f"OELA-{version}-windows-x64.zip"
    zip_dir(built, out)
    print(f"  desktop  {out.name}  ({out.stat().st_size / 1_048_576:.2f} MB)")
    return out


# ---------------------------------------------------------------------- main

def write_manifest(version, artifacts):
    """What was shipped, and its fingerprint. Two jobs.

    A checksum lets someone who downloaded a file over a chat app confirm they
    got the file you built, which matters more here than usual: the whole
    install story is 'a stranger's binary from outside an app store', and the
    honest answer to 'how do I know this is safe' is 'you check it against what
    the author published'. It is also how a future you tells two builds apart
    once both are sitting in a downloads folder called OELA-1.0.apk.
    """
    lines = [f"OELA {version}", ""]
    for path in artifacts:
        lines.append(f"{sha(path)}  {path.name}")
    lines.append("")
    lines.append("Verify on Windows:  certutil -hashfile <file> SHA256")
    lines.append("Verify on Mac/Linux: shasum -a 256 <file>")
    (RELEASE / "CHECKSUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def read_checksums():
    """{filename: sha256} as recorded in release/CHECKSUMS.txt. {} if absent."""
    path = RELEASE / "CHECKSUMS.txt"
    if not path.exists():
        return {}
    recorded = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) == 2 and len(parts[0]) == 64:
            try:
                int(parts[0], 16)
            except ValueError:
                continue
            recorded[parts[1]] = parts[0]
    return recorded


def verify_release_integrity(allow_dirty):
    """Refuse to package on top of a release/ that no longer matches its own sums.

    ⚑ THIS IS THE GUARD, not a diagnostic. RELEASE-NOTES publishes the hashes in
    CHECKSUMS.txt and INSTALL.md tells people to check their download against
    them, so a release/ that has silently drifted is a set that cannot be
    published without making the author's own published numbers wrong. The drift
    is invisible: same filenames, plausible sizes, a folder that looks finished.

    A MISMATCH is fatal -- a file wearing a published name with different bytes
    is the dangerous case, and it is exactly what a stray build leaves behind.
    A MISSING file only warns: it cannot be mistaken for something it is not,
    and deleting a stale artifact is a legitimate way to clean this up.
    """
    recorded = read_checksums()
    if not recorded:
        return
    mismatched, missing = [], []
    for name, want in sorted(recorded.items()):
        path = RELEASE / name
        if not path.exists():
            missing.append(name)
        elif sha(path) != want:
            mismatched.append((name, want, sha(path)))

    for name in missing:
        print(f"  ⚠ release/{name} is listed in CHECKSUMS.txt but is not here")

    if not mismatched:
        return
    lines = ["tools_package: release/ does not match its own CHECKSUMS.txt.\n"]
    for name, want, got in mismatched:
        lines.append(f"  {name}\n    recorded {want}\n    actual   {got}")
    lines.append(
        "\n  Something replaced a file that CHECKSUMS.txt already describes, so this\n"
        "  folder is now a mix of published and not. Publishing it would make the\n"
        "  hashes in RELEASE-NOTES wrong, and INSTALL.md tells people to check them.\n"
        "\n"
        "  Most likely cause: a build that was only ever meant for the phone. Delete\n"
        "  the offending file (GitHub still has the published one) or re-cut the whole\n"
        "  set under a new version.\n"
        "\n"
        "  --allow-dirty-release proceeds anyway, if you know why it differs."
    )
    if allow_dirty:
        print("\n".join(lines))
        print("\n  --allow-dirty-release given; continuing.\n")
        return
    sys.exit("\n".join(lines))


def main():
    args = set(sys.argv[1:])
    unknown = args - {"--no-build", "--android", "--desktop", "--web", "--allow-missing-key",
                      "--allow-dirty-release", "--verify-only"}
    if unknown:
        sys.exit(f"tools_package: unknown option(s): {' '.join(sorted(unknown))}")

    # Cheapest precondition of the lot, so it goes first -- ahead of even the
    # keystore check, because it needs nothing but the files already on disk.
    if "--verify-only" in args:
        verify_release_integrity(False)
        print("release/ matches CHECKSUMS.txt")
        return
    verify_release_integrity("--allow-dirty-release" in args)

    targets = {a for a in args if a in {"--android", "--desktop", "--web"}}
    want_android = not targets or "--android" in targets
    want_desktop = not targets or "--desktop" in targets
    want_web = not targets or "--web" in targets

    # Fail on the missing keystore BEFORE spending a minute on build.py and
    # cap sync -- the same "check the cheap precondition first" ordering
    # tools_pushphone.py uses for the phone being plugged in.
    java_home = android_home = None
    if want_android:
        java_home, android_home = preflight_android()

    RELEASE.mkdir(exist_ok=True)
    BUILD_TMP.mkdir(parents=True, exist_ok=True)

    if "--no-build" not in args:
        build_web()
    elif not DIST_INDEX.exists():
        sys.exit("tools_package: --no-build, but dist/index.html does not exist.")

    version = version_name()
    print(f"\npackaging OELA {version}\n")

    artifacts = []
    if want_web:
        artifacts.append(stage_web(version))
    if want_android:
        artifacts.append(build_apk(version, java_home, android_home,
                                   "--allow-missing-key" in args))
    if want_desktop:
        artifacts.append(build_desktop(version))

    if INSTALL_DOC.exists():
        shutil.copy2(INSTALL_DOC, RELEASE / "INSTALL.md")
        print(f"  doc      INSTALL.md")
    else:
        print("  ⚠ INSTALL.md is missing from the repo root; nothing to hand out with these")

    write_manifest(version, artifacts)
    print(f"  sums     CHECKSUMS.txt")

    print(f"\nrelease/ is ready. Send someone the file for their platform plus INSTALL.md.")


if __name__ == "__main__":
    main()
