#!/usr/bin/env python3
"""Staples src/ into the single self-contained dist/index.html (chunk 0b).

Usage:
    python3 build.py              # one-shot build
    python3 build.py --watch      # rebuild whenever a src/ file changes

Vanilla JS, one IIFE, no framework, no npm (spec.md §3) — so "stapling" is
just template substitution: src/index.html holds two markers,
<!--BUILD:STYLES--> and <!--BUILD:SCRIPT-->, which get replaced with the
concatenated contents of src/styles.css and src/*.js respectively. The JS
files are concatenated in dependency order and wrapped in one IIFE with a
single leading "use strict" (module order below matters for readability
only — every name is a function/var declaration in the same scope, so
hoisting makes call-time order, not text order, the thing that matters).

The manifest and icons ship as separate files alongside dist/index.html
(a web manifest has to be a fetchable resource, not inlined) — everything
else the app needs is in the one HTML file.
"""
import datetime
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
SRC = REPO / "src"
DIST = REPO / "dist"

# Concatenation order: storage has no dependents at parse time but is listed
# first for readability; chunkMap depends on helpers app.js defines
# (genId, saveTasksLocal, state) but that's fine because those are all
# function declarations, hoisted before anything runs.
JS_MODULES = ["storage.js", "textures.js", "surface.js", "runner.js", "pickers.js", "chunkMap.js", "app.js", "events.js"]

ASSET_FILES = ["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"]


def build_stamp():
    """A human-readable marker of WHICH build this is.

    The user tests on a phone against GitHub Pages, which caches HTML for a few
    minutes, so "is the fix in the build I am looking at?" is a question that has
    already cost a round trip. The settings menu shows this, so the answer is
    always on screen.
    """
    when = datetime.datetime.now().strftime("%d %b %H:%M")
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5,
                             cwd=str(REPO)).stdout.strip()
    except Exception:
        sha = ""
    return (when + " · " + sha) if sha else when


def build():
    template = (SRC / "index.html").read_text(encoding="utf-8")
    styles = (SRC / "styles.css").read_text(encoding="utf-8")

    script_parts = []
    for name in JS_MODULES:
        script_parts.append((SRC / name).read_text(encoding="utf-8").rstrip("\n"))
    script = "(function(){\n\"use strict\";\n\n" + "\n\n".join(script_parts) + "\n\n})();\n"

    # Stamp WHICH build this is, so the running app can say so on the device.
    if "__BUILD_STAMP__" not in script:
        sys.exit("build.py: __BUILD_STAMP__ placeholder is missing from src/")
    script = script.replace("__BUILD_STAMP__", build_stamp())

    if "<!--BUILD:STYLES-->" not in template:
        sys.exit("build.py: src/index.html is missing the <!--BUILD:STYLES--> marker")
    if "<!--BUILD:SCRIPT-->" not in template:
        sys.exit("build.py: src/index.html is missing the <!--BUILD:SCRIPT--> marker")

    out = template.replace("<!--BUILD:STYLES-->", styles.rstrip("\n"))
    out = out.replace("<!--BUILD:SCRIPT-->", script.rstrip("\n"))

    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(out, encoding="utf-8", newline="\n")

    for name in ASSET_FILES:
        src_path = SRC / "assets" / name if name != "manifest.webmanifest" else SRC / name
        shutil.copyfile(src_path, DIST / name)

    print(f"built {DIST / 'index.html'} ({len(out)} bytes)")


def watch():
    watched = [SRC / "index.html", SRC / "styles.css"] + [SRC / m for m in JS_MODULES]
    build()
    mtimes = {f: f.stat().st_mtime for f in watched}
    print("watching src/ for changes (Ctrl+C to stop)...")
    try:
        while True:
            time.sleep(0.5)
            changed = False
            for f in watched:
                m = f.stat().st_mtime
                if mtimes.get(f) != m:
                    mtimes[f] = m
                    changed = True
            if changed:
                build()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    if "--watch" in sys.argv:
        watch()
    else:
        build()
