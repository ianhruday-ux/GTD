"""Every id spliced into an HTML attribute goes through escapeHtml(). Forever.

This is a SOURCE scan, not a browser test -- the sibling of
checks/i18n_no_hardcoded.py, and for the same reason. The security audit of
2026-08-03 found 100 sites building attributes as

    'data-id="' + task.id + '"'

which is safe exactly as long as ids come from genId(). Import let a file supply
one, and `x"><img src=q onerror=…>` broke out of the attribute and executed.
Both halves were fixed: the import path refuses such a file
(checks/untrusted_input.py), and all 100 sinks now escape.

A rendering test cannot hold this line. It would have to know every screen that
builds an attribute from an id, and the next one written would go uncovered --
which is precisely how the 100 accumulated. So this walks the source instead:
find the pattern, assert it is escaped, no exceptions list.

Deliberately NOT flagged: the enum-shaped interpolations (data-kind="' + kind,
data-lane="' + laneKind) and numeric indexes. Those are internal constants, not
record fields, and no untrusted path can reach them -- adding them would be
noise that trains people to ignore this check. If a `kind` ever starts coming
from stored data, that assumption breaks and this comment is where to start.
"""
import os, re, sys, glob

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")

# `attr="' + EXPR + '"` — the one shape every attribute in this codebase uses.
ATTR = re.compile("(=\"'\\s*\\+\\s*)([A-Za-z_$][\\w$.]*)(\\s*\\+\\s*'\")")
# An expression naming a record identifier: foo.id, foo.barId, a bare id/…Id,
# plus l.key, which the review surface sets to a task id (loops.push({key: t.id})).
ID_EXPR = re.compile("^(?:[A-Za-z_$][\\w$]*\\.)*(?:id|[A-Za-z]*Id)$")

fails, notes = [], []
def check(cond, msg):
    (notes if cond else fails).append(("PASS " if cond else "FAIL ") + msg)


def is_id_expr(e):
    return bool(ID_EXPR.match(e)) or e == "l.key"


offenders, scanned, escaped_count = [], 0, 0
for path in sorted(glob.glob(os.path.join(SRC, "*.js"))):
    name = os.path.basename(path)
    for lineno, line in enumerate(open(path, encoding="utf-8"), 1):
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue                      # a comment quoting the pattern is not a sink
        # ⚠ Count EVERY attribute interpolation, escaped or not. ATTR only
        # matches a bare member expression, so wrapping a sink in escapeHtml()
        # removes it from that count -- an earlier version of this check
        # asserted on ATTR's total and started failing the moment the fix
        # landed, for no reason but its own bookkeeping.
        scanned += len(re.findall("=\"'\\s*\\+", line))
        for m in ATTR.finditer(line):
            if is_id_expr(m.group(2)):
                offenders.append(f"{name}:{lineno}  {m.group(2)}")
        # count the escaped id sinks so the check can prove it is actually looking
        for m in re.finditer("=\"'\\s*\\+\\s*escapeHtml\\(([A-Za-z_$][\\w$.]*)\\)", line):
            if is_id_expr(m.group(1)):
                escaped_count += 1

check(not offenders,
      "no id reaches an HTML attribute unescaped (%d offender(s)%s)"
      % (len(offenders), ": " + "; ".join(offenders[:8]) if offenders else ""))

# A guard on the guard: if a refactor changed how attributes are built, the scan
# above would find nothing and pass vacuously. It must still SEE the escaped ones.
check(escaped_count >= 90,
      "the scan still recognises the codebase's attribute shape -- %d escaped id sinks found "
      "(expected ~100; a collapse to 0 means this check has gone blind, not that the code got safer)"
      % escaped_count)

check(scanned >= 200,
      "and it walked a realistic number of attribute interpolations (%d)" % scanned)

for line in notes + fails:
    print(line)
print(f"\n{len(notes)} passed, {len(fails)} failed")
raise SystemExit(1 if fails else 0)
