#!/usr/bin/env python3
"""Staples src/ into the single self-contained dist/index.html (chunk 0b).

Usage:
    python build.py               # one-shot build
    python build.py --watch       # rebuild whenever a src/ file changes

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
import base64
import datetime
import hashlib
import json
import shutil
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
# ⚠ i18n.js sits right after storage.js and must STAY early: its STRINGS/LOCALES
# are `const`, so they are in the temporal dead zone until this file is
# evaluated. Function declarations hoist and do not care about order; consts do.
JS_MODULES = ["storage.js", "sync.js", "dropboxTransport.js", "desktopTransport.js", "i18n.js", "textures.js", "surface.js", "runner.js", "pickers.js", "chunkMap.js", "app.js", "events.js", "swClient.js"]

# ⚑ THIRD-PARTY-NOTICES.txt is here to reach the APK. capacitor.config.json sets
# webDir to ../dist, so `npx cap sync` copies everything build() writes into the
# Android project's assets/ — which is the only route a file has into the APK,
# and Capacitor's MIT notice has to be IN the APK ("included in all copies").
# It rides along into the Pages deploy and the Windows build too, which is
# harmless and mildly useful. Being in ASSET_FILES also precaches it, so it is
# readable offline like everything else.
ASSET_FILES = ["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png",
               "THIRD-PARTY-NOTICES.txt"]

# Chunk 9 (service-worker-plan.md §5): the SW's precache list is DERIVED from
# what build() actually ships, so it can't drift from ASSET_FILES by hand-
# maintaining a second copy. "index.html" covers the app shell; the bare scope
# root ("./") is deliberately NOT precached here — sw.js's fetch handler serves
# the cached index.html for every navigation instead (the navigation-fallback
# trap, plan §9.2), which covers the bare-directory-URL case without a second,
# redundant precache fetch of the same bytes under a different cache key.
SW_PRECACHE_FILES = ["index.html"] + ASSET_FILES


def build_fonts():
    """@font-face rules with each woff2 inlined as a base64 data URI.

    src/index.html used to <link> all three families from fonts.googleapis.com,
    which quietly broke the app's central promise: with no network and a cold
    cache, every surface fell back to system fonts. dist/index.html was already
    self-contained in every other respect, so that one line was the whole gap.

    Inlining rather than shipping the woff2 files alongside dist/ is deliberate
    and follows the existing rule -- dist/index.html is ONE self-contained file
    you can open from disk (CLAUDE.md). Separate font files would be four more
    fetches that a file: origin resolves differently than a served one.

    The manifest is written by tools_getfonts.py; nothing here is hand-edited.
    Base64 costs a third on top of 99 KB, which is the honest price of the
    offline guarantee.
    """
    fonts_dir = SRC / "assets" / "fonts"
    manifest_path = fonts_dir / "fonts.json"
    if not manifest_path.exists():
        sys.exit("build.py: src/assets/fonts/fonts.json is missing — run tools_getfonts.py")

    faces = json.loads(manifest_path.read_text(encoding="utf-8"))
    # ⚑ THE NOTICE BELOW IS A LICENCE OBLIGATION, NOT DECORATION. Do not trim it
    # to a link. OFL 1.1 condition 2 requires that "each copy contains the above
    # copyright notice AND THIS LICENSE" — the licence text itself. Two earlier
    # versions of this block failed that, each by pointing somewhere instead of
    # containing something: first "see src/assets/fonts/README.md" (src/ does not
    # travel with the product), then a bare openfontlicense.org URL (an outward
    # pointer in a file whose entire promise is that it works with no network).
    # The fonts are base64-embedded in this same file, so the copy IS this file,
    # and the licence has to be in it. A "human-readable header" is one of the
    # three forms the OFL names, which is exactly what a CSS comment is.
    #
    # This one block discharges the obligation for all three artifacts: the same
    # payload is byte-for-byte inside the APK and the Windows zip, verified by
    # tools_package.py. Capacitor's MIT notice is APK-only and lives in
    # src/assets/THIRD-PARTY-NOTICES.txt. Poly Haven's textures are CC0 and
    # require nothing; they are credited in textures.js because the work
    # deserves naming, not because it is owed.
    ofl_path = fonts_dir / "OFL.txt"
    if not ofl_path.exists():
        sys.exit("build.py: src/assets/fonts/OFL.txt is missing — the OFL requires the "
                 "licence TEXT to ship with the fonts, so the build cannot proceed without it")
    ofl = ofl_path.read_text(encoding="utf-8").strip()
    if "*/" in ofl:
        sys.exit("build.py: OFL.txt contains */ and would close the CSS comment early, "
                 "silently truncating the notice and breaking every style after it")

    rules = ["/* Vendored webfonts — generated by build.py from src/assets/fonts/.",
             "",
             "   Inter — Copyright (c) The Inter Project Authors",
             "     https://github.com/rsms/inter",
             "   Space Grotesk — Copyright (c) The Space Grotesk Project Authors",
             "     https://github.com/floriankarsten/space-grotesk",
             "   IBM Plex Mono — Copyright (c) 2017 IBM Corp.",
             "     https://github.com/IBM/plex",
             "",
             "   All three families are licensed under the SIL Open Font License,",
             "   Version 1.1, reproduced in full below. None are modified here",
             "   beyond Google Fonts' own latin subsetting.",
             "",
             "   " + "-" * 68,
             ""]
    rules += ["   " + line if line.strip() else "" for line in ofl.split("\n")]
    rules += ["*/"]
    for face in faces:
        path = fonts_dir / face["file"]
        if not path.exists():
            sys.exit(f"build.py: {path} is listed in fonts.json but missing — run tools_getfonts.py")
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        rules.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;"
            "src:url(data:font/woff2;base64,%s) format('woff2');}"
            % (face["family"], face["weight"], b64)
        )
    return "\n".join(rules)


def build_stamp():
    """A human-readable marker of WHICH build this is.

    The user tests on a phone against GitHub Pages, which caches HTML for a few
    minutes, so "is the fix in the build I am looking at?" is a question that has
    already cost a round trip. The settings menu shows this, so the answer is
    always on screen.

    THE SHA IS GONE, and its absence is the point. This used to append
    `git rev-parse --short HEAD`. That sha was RELIABLY WRONG BY ONE: dist/ is
    built and THEN committed, so the sha read at build time always named the
    commit before the one that ships the build. It looked authoritative and
    answered "which commit am I on?" incorrectly every single time, which is
    worse than saying nothing because it invites you to trust it.

    Two ways to make it right were on the table: rebuild-then-amend after every
    commit (a permanent second step on every change, to fix a label), or drop the
    sha. Dropped. The timestamp alone answers the question this exists for --
    "is this the build I just made?" -- and it cannot be wrong.
    """
    return datetime.datetime.now().strftime("%d %b %H:%M")


def sw_version(out_html, asset_bytes):
    """Content hash of everything the SW precaches (service-worker-plan.md §4.2).

    NOT build_stamp() — that's minute-resolution ("%d %b %H:%M"), so two builds
    in the same minute would collide and the second would be served from the
    first's cache. A content hash also means "no bytes changed -> same version
    -> no needless update prompt" for free.
    """
    h = hashlib.sha256()
    h.update(out_html.encode("utf-8"))
    for b in asset_bytes:
        h.update(b)
    return h.hexdigest()[:12]


def build_sw(out_html, asset_bytes):
    template = (SRC / "sw.js").read_text(encoding="utf-8")
    version = sw_version(out_html, asset_bytes)

    if "__SW_VERSION__" not in template:
        sys.exit("build.py: __SW_VERSION__ placeholder is missing from src/sw.js")
    if "__SW_PRECACHE__" not in template:
        sys.exit("build.py: __SW_PRECACHE__ placeholder is missing from src/sw.js")

    script = template.replace("__SW_VERSION__", version)
    script = script.replace("__SW_PRECACHE__", json.dumps(SW_PRECACHE_FILES))
    (DIST / "sw.js").write_text(script, encoding="utf-8", newline="\n")
    return version


# The CSP, minus the script hash, which only exists once the bundle is stapled.
#
# Every directive here is either the security point or a thing the app provably
# needs; `default-src 'none'` denies the rest, so anything added to the app that
# fetches a new KIND of resource fails closed and lands here deliberately.
#
#   script-src   the whole point — one hash, no 'self', no 'unsafe-inline'.
#                CSP3 ignores 'unsafe-inline' when a hash is present, so the two
#                cannot be combined as a hedge even by accident.
#   style-src    'unsafe-inline' is unavoidable and not a hedge: the two <style>
#                blocks are inline by design (one self-contained file) and the
#                markup carries 23 inline style= attributes. Hashing them is not
#                possible for the ones JS writes at runtime.
#   img-src      'self' for the icons, data: for the fonts' sibling — the desk
#                textures are canvas-generated data: JPEGs used as CSS
#                backgrounds, which CSP counts as images — blob: for exports.
#   font-src     data: only: build_fonts() inlines all three families as base64.
#   connect-src  the two Dropbox Content API calls in dropboxTransport.js. OAuth
#                is native (DropboxAuthPlugin), so no auth host is needed here.
#   worker-src   sw.js. Registration is skipped on native (swClient.js:33), so
#                this matters on the web build only.
#   manifest-src manifest.webmanifest, the thing that makes the app installable.
#
# ⚠ 'self' matches an ORIGIN, and a file: page's origin is opaque, so the two
# 'self' entries buy nothing when dist/index.html is opened straight from disk.
# That mode was verified under this policy anyway: the app boots, all four font
# faces load, and nothing is reported blocked — because everything that matters
# offline is inline or a data: URI. At most the favicon and the manifest go
# unresolved there, which is cosmetic and already true of file: for the manifest.
# The served builds (Pages, Android's local server, the checks' http server) all
# match 'self' normally.
CSP_DIRECTIVES = [
    "default-src 'none'",
    "script-src '{script_hash}'",
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src data:",
    "connect-src 'self' https://content.dropboxapi.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
]


def csp_meta(out_html):
    """The CSP <meta>, with script-src naming the sha256 of the stapled script.

    The hash is taken from the FINAL html rather than from the `script` string
    build() assembled, and that is the entire reason this function reads the
    output back instead of being handed the bundle. What a browser hashes is the
    script element's text content exactly as parsed — including the newlines the
    template puts either side of <!--BUILD:SCRIPT--> . Hashing the bundle would
    be right up until someone edits the whitespace in src/index.html, and the
    symptom of being one newline out is a blank app, on every platform at once.
    """
    if out_html.count("<script>") != 1:
        sys.exit("build.py: expected exactly one inline <script> to hash — "
                 "the CSP names one hash and cannot cover a second script")
    body = out_html.split("<script>", 1)[1].rsplit("</script>", 1)[0]
    digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode("ascii")
    policy = "; ".join(CSP_DIRECTIVES).format(script_hash="sha256-" + digest)
    return '<meta http-equiv="Content-Security-Policy" content="%s">' % policy


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

    if "<!--BUILD:FONTS-->" not in template:
        sys.exit("build.py: src/index.html is missing the <!--BUILD:FONTS--> marker")
    if "<!--BUILD:STYLES-->" not in template:
        sys.exit("build.py: src/index.html is missing the <!--BUILD:STYLES--> marker")
    if "<!--BUILD:SCRIPT-->" not in template:
        sys.exit("build.py: src/index.html is missing the <!--BUILD:SCRIPT--> marker")
    if "<!--BUILD:CSP-->" not in template:
        sys.exit("build.py: src/index.html is missing the <!--BUILD:CSP--> marker")

    out = template.replace("<!--BUILD:FONTS-->", build_fonts())
    out = out.replace("<!--BUILD:STYLES-->", styles.rstrip("\n"))
    out = out.replace("<!--BUILD:SCRIPT-->", script.rstrip("\n"))

    # LAST, and after the script is in place: the policy names a hash of the
    # stapled script, so it cannot be computed before the stapling. Substituting
    # the meta afterwards is safe in the other direction too — it changes the
    # <head>, never the script element the hash covers.
    out = out.replace("<!--BUILD:CSP-->", csp_meta(out))

    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_text(out, encoding="utf-8", newline="\n")

    asset_bytes = []
    for name in ASSET_FILES:
        src_path = SRC / "assets" / name if name != "manifest.webmanifest" else SRC / name
        shutil.copyfile(src_path, DIST / name)
        asset_bytes.append(src_path.read_bytes())

    version = build_sw(out, asset_bytes)

    print(f"built {DIST / 'index.html'} ({len(out)} bytes), sw {version}")


def watch():
    watched = ([SRC / "index.html", SRC / "styles.css", SRC / "sw.js",
                SRC / "assets" / "fonts" / "fonts.json"]
               + [SRC / m for m in JS_MODULES])
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
