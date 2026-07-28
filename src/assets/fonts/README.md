# Vendored webfonts

These are **not** hand-maintained. Regenerate with:

```bash
python3 tools_getfonts.py
```

`build.py` reads `fonts.json` and inlines each `.woff2` into `dist/index.html` as a base64 data
URI, so the product stays one self-contained file and the app renders correctly with **no network
at all**. Before this, `src/index.html` linked `fonts.googleapis.com` — the single thing standing
between the app and its own local-first promise (found in the wrapper audit, `wrapper-plan.md`
§3.5).

Only the **latin** subset is vendored. It spans U+0000–00FF, so Western European accents are
covered; `latin-ext`, cyrillic, greek and vietnamese are not. The Chinese locale is unaffected —
none of these families contain CJK glyphs, so `zh-Hans` rendered from a system font before and
still does. Arrows and check marks (← ✓ ▸ 🗑) are outside every subset Google serves for these
families and likewise fell back before this change and still do.

Inter and Space Grotesk are **variable** fonts — one file each covers the whole weight range.
IBM Plex Mono has no variable build on Google Fonts, so its two weights are two files.

## Licences

All three families are licensed under the **SIL Open Font License, Version 1.1**, which permits
bundling and redistribution. Full text: <https://openfontlicense.org/>

| Family | Copyright |
|---|---|
| **Inter** | Copyright © The Inter Project Authors — <https://github.com/rsms/inter> |
| **Space Grotesk** | Copyright © The Space Grotesk Project Authors — <https://github.com/floriankarsten/space-grotesk> |
| **IBM Plex Mono** | Copyright © 2017 IBM Corp. — <https://github.com/IBM/plex> |

Under the OFL these fonts may be bundled and redistributed, with or without modification, provided
this notice travels with them and they are not sold on their own. None are modified here beyond
Google Fonts' own latin subsetting.
