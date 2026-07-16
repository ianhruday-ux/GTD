"""
Fixtures for the chunk-0b certification suite.

Lives in tests/chunk0b/ (its own package) so it does NOT clobber the repo's
existing tests/conftest.py. If you'd rather hoist these into the top-level
conftest, they're written to be portable.

The whole suite is built around ONE idea that the spec's mandate forces:

    Chunk 0b is a refactor with a "zero behavior change" contract (spec §2).
    The cheapest, most honest way to certify "no behavior change before and
    after 0b" is a BEFORE/AFTER comparison of two builds running the SAME
    user interactions. You don't assert what the app *should* do — you assert
    the post-0b build does exactly what the pre-0b build did. That means these
    tests don't depend on hand-coded expected values, only on the two builds
    agreeing.

You point the suite at two builds via env vars:

    GTD_BASELINE   = the build IMMEDIATELY BEFORE 0b  (post-0a working tree)
    GTD_CANDIDATE  = the build AFTER 0b               (dist/index.html)

Both are single self-contained HTML files. If either is unset/missing, the
parity tests skip cleanly (rather than fail) so the file is safe to keep in
the tree. The 0b-delta tests (test_0b_deltas.py) only need GTD_CANDIDATE.

    GTD_BASELINE=../after-0a/index.html \
    GTD_CANDIDATE=../dist/index.html \
    python3 -m pytest tests/chunk0b/ -v
"""

import contextlib
import functools
import http.server
import os
import socket
import socketserver
import threading

import pytest

# ---------------------------------------------------------------------------
# Build locations (override via env; sensible repo-relative defaults)
# ---------------------------------------------------------------------------
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _resolve(env_name, *default_relparts):
    val = os.environ.get(env_name)
    if val:
        return os.path.abspath(val)
    return os.path.join(_REPO, *default_relparts)


BASELINE_PATH = _resolve("GTD_BASELINE", "dist", "index.baseline.html")
CANDIDATE_PATH = _resolve("GTD_CANDIDATE", "dist", "index.html")


def _skip_if_missing(path, which, env):
    if not os.path.isfile(path):
        pytest.skip(
            f"{which} build not found at {path!r}. "
            f"Set {env} to a self-contained HTML build."
        )


# ---------------------------------------------------------------------------
# A tiny static server per build directory.
#
# We serve over http rather than file:// on purpose: localStorage on file://
# origins is isolated/flaky across Chromium versions, and a <link rel=manifest>
# only resolves against a real origin. Serving matches how GitHub Pages runs it.
# ---------------------------------------------------------------------------
def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):  # silence per-request logging
        pass


@contextlib.contextmanager
def _serve(directory):
    port = _free_port()
    handler = functools.partial(_QuietHandler, directory=directory)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)
    httpd.daemon_threads = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        httpd.shutdown()
        httpd.server_close()


def _url_for(base_url, path):
    return f"{base_url}/{os.path.basename(path)}"


@pytest.fixture(scope="session")
def baseline_url():
    _skip_if_missing(BASELINE_PATH, "Baseline (pre-0b)", "GTD_BASELINE")
    with _serve(os.path.dirname(BASELINE_PATH)) as base:
        yield _url_for(base, BASELINE_PATH)


@pytest.fixture(scope="session")
def candidate_url():
    _skip_if_missing(CANDIDATE_PATH, "Candidate (post-0b)", "GTD_CANDIDATE")
    with _serve(os.path.dirname(CANDIDATE_PATH)) as base:
        yield _url_for(base, CANDIDATE_PATH)
