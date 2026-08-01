#!/usr/bin/env python3
"""The Electron shell finds the Dropbox app folder whatever the parent is called.

    python checks/desktop_sync_path.py

WHAT THIS COVERS. Dropbox mirrors an API-scoped App Folder on disk at
"<Dropbox root>/Apps/<registered folder name>/", and W6 hardcoded both halves.
The registered name was already caught once and fixed (wrapper-plan.md §6, trap
10). The parent was not: **Dropbox localizes "Apps"** -- "Aplicaciones" in
Spanish, "Applications" in French -- so on a non-English account the desktop
transport read a path that does not exist and would then create an ordinary
folder next to the real one. Two devices, two files, no error: the same silent
divergence trap 10 is about, reached from the other side.

WHY IT IS NOT A PLAYWRIGHT FILE, unlike everything else in this directory.
Every other check drives dist/index.html in a browser because that is where the
app is. This code is not in the app -- it is in the Electron main process, which
has no DOM at all and never renders anything. Protocol 1 ("assert on something
RENDERED") exists to stop checks from asserting on storage while the screen is
wrong; there is no screen on this side of the bridge to be wrong. What there is
instead is a real filesystem, so this drives the REAL module (wrapper/electron/
syncPath.js, required by main.js) against REAL temporary directories via node.
No reimplementation of the logic, which protocol 2 would not accept anyway.

PROVEN TO FAIL, per protocol 2, by sabotage: making resolveAppFolder() return
the hardcoded Apps/ path without ever scanning gives **6 passed, 2 failed** --
the two localized-account checks (2 and 3), failing for the right reason, with
the actual value showing the wrong parent folder rather than an exception.

The other six pass under sabotage too, and that is the point rather than a
weakness: they pin behaviour that must NOT change. An English account (1) and
the three fallback cases (4, 5, 7) are what the hardcoded version already got
right, and the determinism pair (6) holds under both. If a later fix to the
residual case breaks one of them, it is a real regression -- which is only
detectable because they were never contingent on this change.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MODULE = REPO / "wrapper" / "electron" / "syncPath.js"

APP_FOLDER = "OELA_sync_ianhruday"
SYNC_FILE = "oela-sync.json"

passed = 0
failed = 0
notes = []


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        notes.append(f"  ok   {label}")
    else:
        failed += 1
        notes.append(f"  FAIL {label}\n         expected {expected!r}\n         actual   {actual!r}")


def resolve(root):
    """Call the real resolveSyncFile() in node and hand back what it returned."""
    script = (
        "const { resolveSyncFile } = require(%s);\n"
        "const fsp = require('fs/promises');\n"
        "resolveSyncFile(process.argv[1], fsp)\n"
        "  .then(p => { process.stdout.write(p); })\n"
        "  .catch(e => { process.stderr.write(String(e)); process.exit(1); });\n"
    ) % json.dumps(str(MODULE).replace("\\", "/"))
    r = subprocess.run([node_bin(), "-e", script, str(root)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"node failed: {r.stderr.strip()}")
    return r.stdout.strip()


def node_bin():
    return shutil.which("node") or "node"


def make_root(tmp, *dirs):
    root = Path(tmp)
    for d in dirs:
        (root / d).mkdir(parents=True, exist_ok=True)
    return root


def main():
    if not MODULE.exists():
        print(f"desktop_sync_path: {MODULE} does not exist.")
        print("  Nothing to check -- the shell still hardcodes its path.")
        sys.exit(1)
    if not shutil.which("node"):
        print("desktop_sync_path: node is not on PATH.")
        sys.exit(1)

    print("Dropbox app-folder resolution (wrapper/electron/syncPath.js)\n")

    # 1. The ordinary English account. Must keep working exactly as before --
    #    this is the case the hardcoded version got right, and the one every
    #    device test so far has actually run.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp, f"Apps/{APP_FOLDER}")
        check("English account resolves under Apps/",
              resolve(root), str(root / "Apps" / APP_FOLDER / SYNC_FILE))

    # 2. THE BUG. A Spanish account, where Dropbox called the parent
    #    "Aplicaciones" and there is no folder called Apps at all.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp, f"Aplicaciones/{APP_FOLDER}")
        check("localized parent (Aplicaciones) is found",
              resolve(root), str(root / "Aplicaciones" / APP_FOLDER / SYNC_FILE))

    # 3. The same, with ordinary Dropbox clutter around it -- the scan has to
    #    pick the folder that CONTAINS the app folder, not the first one it sees.
    #    Named folders rather than a count, per protocol 2c.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp, "Documents", "Photos", "Aplicaciones/" + APP_FOLDER,
                         "Zoom", "Camera Uploads")
        check("found among unrelated folders, not the alphabetically first",
              resolve(root), str(root / "Aplicaciones" / APP_FOLDER / SYNC_FILE))

    # 4. Nothing linked anywhere yet: no app folder exists under any name. This
    #    is the residual case syncPath.js's own comment flags as NOT closed --
    #    pinned here so that the fallback is a decision on record rather than an
    #    accident, and so a later fix has to change this line deliberately.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp, "Documents", "Photos")
        check("nothing linked yet falls back to Apps/ (documented residual)",
              resolve(root), str(root / "Apps" / APP_FOLDER / SYNC_FILE))

    # 5. A completely empty Dropbox root. Same fallback, no crash on readdir.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp)
        check("empty root falls back to Apps/ without throwing",
              resolve(root), str(root / "Apps" / APP_FOLDER / SYNC_FILE))

    # 6. Both an English and a localized candidate. The answer must be stable --
    #    a resolver that picks differently on two runs, or on two machines,
    #    reintroduces exactly the divergence this file exists to prevent. Apps/
    #    wins because that is what an already-syncing account was using.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp, f"Aplicaciones/{APP_FOLDER}", f"Apps/{APP_FOLDER}")
        first = resolve(root)
        second = resolve(root)
        check("two candidates resolve to Apps/ (the incumbent)",
              first, str(root / "Apps" / APP_FOLDER / SYNC_FILE))
        check("...and resolve identically on a second call",
              second, first)

    # 7. A file, not a directory, sitting where the app folder would be. Must be
    #    ignored rather than returned -- otherwise the transport would try to
    #    mkdir over a file and fail in a way nobody could read.
    with tempfile.TemporaryDirectory() as tmp:
        root = make_root(tmp, "Aplicaciones")
        (root / "Aplicaciones" / APP_FOLDER).write_text("not a folder", encoding="utf-8")
        check("a FILE named like the app folder is not mistaken for it",
              resolve(root), str(root / "Apps" / APP_FOLDER / SYNC_FILE))

    print("\n".join(notes))
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
