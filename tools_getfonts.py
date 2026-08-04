#!/usr/bin/env python3
"""Re-download the vendored webfonts into src/assets/fonts/.

    python tools_getfonts.py

Run this by hand, only when a font needs updating. It is NOT part of the build —
build.py just inlines whatever is already sitting in src/assets/fonts/, guided by
the fonts.json this script writes.

WHY THE FONTS ARE VENDORED AT ALL
---------------------------------
src/index.html used to pull all three families from fonts.googleapis.com. The app
promises to work with zero network (CLAUDE.md: "local-first is not negotiable"),
and dist/index.html is otherwise genuinely self-contained — so that one <link> was
the single thing standing between the app and its own promise. On a cold cache
with no connection, every surface fell back to system fonts. Found in the wrapper
audit (wrapper-plan.md §3.5); it was a browser-build bug, not a wrapper one.

WHAT GETS DOWNLOADED
--------------------
The `latin` subset only. It spans U+0000-00FF, so every accented character in
Western European text is covered; `latin-ext` (Polish, Czech, Turkish and the
like) is skipped, as are cyrillic, greek and vietnamese. The Chinese locale is
unaffected either way — none of these three families contain CJK glyphs, so
zh-Hans already rendered from a system font and still does.

Arrows and check marks (U+2190 ←, U+2713 ✓, U+25B8 ▸ …) are outside every subset
Google serves for these families, so they fell back to a system font before this
change and still do. Vendoring changes nothing about them.

VARIABLE VS STATIC
------------------
Inter and Space Grotesk ship from Google as VARIABLE fonts: one file covers every
weight, and requesting three weights returns the same bytes three times (verified
by hash). So they are fetched once each over their full range. IBM Plex Mono has
no variable version there, so its two weights are two real files.

LICENSING
---------
All three families are SIL Open Font License 1.1, which permits bundling. See
src/assets/fonts/README.md for the notice this vendoring obliges us to carry.
"""
import json
import os
import re
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src", "assets", "fonts")

# (google family spec, family name, output basename)
# The two variable families are requested over their FULL range so one file can
# serve every weight; the ranges are Google's own, read off the css2 response.
REQUESTS = [
    ("Inter:wght@100..900", "Inter", "Inter-var"),
    ("Space+Grotesk:wght@300..700", "Space Grotesk", "SpaceGrotesk-var"),
    ("IBM+Plex+Mono:wght@500;600", "IBM Plex Mono", "IBMPlexMono"),
]


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode("utf-8")


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest, total = [], 0

    for spec, family, base in REQUESTS:
        css = fetch("https://fonts.googleapis.com/css2?family=%s&display=swap" % spec)
        blocks = re.findall(r"/\*\s*([a-z-]+)\s*\*/\s*(@font-face\s*\{.*?\})", css, re.S)
        seen = set()
        for subset, block in blocks:
            if subset != "latin":
                continue
            weight = re.search(r"font-weight:\s*([\d ]+);", block).group(1).strip()
            url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
            if url in seen:          # a variable family repeats one file per weight
                continue
            seen.add(url)
            name = base + (".woff2" if " " in weight or base.endswith("-var")
                           else "-" + weight + ".woff2")
            data = fetch(url, binary=True)
            with open(os.path.join(OUT, name), "wb") as f:
                f.write(data)
            manifest.append({"family": family, "weight": weight, "file": name})
            total += len(data)
            print("%-26s weight %-9s %6.1f KB" % (name, weight, len(data) / 1024))

    manifest.sort(key=lambda m: (m["family"], m["weight"]))
    with open(os.path.join(OUT, "fonts.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print("-" * 52)
    print("%-26s %19.1f KB  (~%.0f KB inlined)" % ("TOTAL", total / 1024, total * 4 / 3 / 1024))
    print("wrote fonts.json (%d faces)" % len(manifest))


if __name__ == "__main__":
    main()
