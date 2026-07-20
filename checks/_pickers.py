"""Shared helpers for driving the app's own date/time pickers from a check.

The date and time fields are readonly now (that is what stops the phone's own
picker opening over ours), so `page.fill()` on one fails with "element is not
editable". Anything that used to fill a date or a time has to go through the
picker instead — which is closer to what a person does anyway.

⚠ Imported as a sibling: `python checks/foo.py` puts checks/ on sys.path, so
`from _pickers import pick_date` works. Do NOT rename this to test_*.py; the
repo's pytest collector must keep ignoring everything in here.
"""
import math

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def _ordinal(label):
    # ⚠ compare months as ORDINALS, never as strings — "May 2026" > "June 2026"
    # is true alphabetically, which sends the navigation the wrong way forever.
    name, year = label.split()
    return int(year) * 12 + MONTHS.index(name)


def pick_date(pg, selector, iso, timeout_steps=48):
    """Open the date picker on `selector` and choose `iso` (YYYY-MM-DD)."""
    pg.locator(selector).first.click()
    pg.wait_for_timeout(350)
    y, m, _d = iso.split("-")
    target = _ordinal(MONTHS[int(m) - 1] + " " + y)
    for _ in range(timeout_steps):
        cell = pg.locator('[data-dp="day"][data-date="%s"]' % iso)
        if cell.count():
            cell.first.click()
            pg.wait_for_timeout(350)
            return True
        cur = _ordinal(pg.locator(".dp-label").first.inner_text().strip())
        pg.click('[data-dp="next"]' if target > cur else '[data-dp="prev"]')
        pg.wait_for_timeout(140)
    raise AssertionError("date picker never reached " + iso)


def pick_time(pg, selector, hh_mm):
    """Open the time picker on `selector` and choose 24h "HH:MM"."""
    pg.locator(selector).first.click()
    pg.wait_for_timeout(350)
    h24, mi = (int(x) for x in hh_mm.split(":"))
    face = h24 % 12
    if face == 0:
        face = 12
    box = pg.locator(".tp-dial").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    def dial(deg, radius=92):
        a = math.radians(deg - 90)
        pg.mouse.move(cx + math.cos(a) * radius, cy + math.sin(a) * radius)
        pg.mouse.down(); pg.mouse.up(); pg.wait_for_timeout(220)

    dial((face % 12) * 30)          # hour; picking one advances to minutes
    dial(mi * 6)                    # minute
    pg.click('[data-tp="pm"]' if h24 >= 12 else '[data-tp="am"]')
    pg.wait_for_timeout(150)
    pg.click('[data-tp="set"]')
    pg.wait_for_timeout(350)


def clear_date(pg, selector):
    pg.locator(selector).first.click()
    pg.wait_for_timeout(300)
    pg.click('[data-dp="clear"]')
    pg.wait_for_timeout(300)
