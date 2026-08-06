#!/usr/bin/env python3
"""Copy the Android signing key somewhere safe, and check an existing copy.

    python tools_backup_keystore.py <folder>    # back up to <folder>
    python tools_backup_keystore.py --check <folder>   # is that copy current?

WHY THIS EXISTS. Android identifies an app by its signing certificate.
wrapper/android/release.keystore is what lets a new APK install OVER the one on
the author's phone and his friends' phones. Lose it and every future build is a
different app as far as Android is concerned: INSTALL_FAILED_UPDATE_INCOMPATIBLE,
and the only way across is uninstalling -- which takes the phone's local data
with it. There is no recovery, no reissue, and no support desk. It is correctly
NOT in git, because it is a private key, which means git is not protecting it
either.

⚑ THIS IS THE ONE PUBLISHING TRAP THAT CANNOT BE CLOSED IN CODE. tools_package.py
already refuses to build when the key is MISSING; nothing can detect that it
exists in only one place. That needs a human to copy two files off this machine,
so the least this repo can do is make it one command that verifies itself.

⚠ keystore.properties CONTAINS THE STORE PASSWORD IN PLAIN TEXT. A backup of
these two files together is enough to sign software as the author. So:

  * Do NOT put this in a folder that syncs to the cloud without thinking about
    it. On this machine the Desktop mirrors to Google Drive, so "back it up to
    the Desktop" quietly means "upload the signing key and its password".
  * A USB stick, an external drive, or an encrypted archive is the right shape.
  * This script will not pick a destination for you, on purpose.
"""
import hashlib
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
ANDROID = REPO / "wrapper" / "android"
FILES = ["release.keystore", "keystore.properties"]


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sources():
    missing = [n for n in FILES if not (ANDROID / n).exists()]
    if missing:
        sys.exit(
            "tools_backup_keystore: nothing to back up -- these are not here:\n"
            + "".join(f"    {ANDROID / n}\n" for n in missing)
            + "  If the key is genuinely gone, a rebuilt app can no longer update any\n"
              "  installed copy. See the module docstring."
        )
    return [(n, ANDROID / n) for n in FILES]


def check(dest):
    """Report whether dest already holds a current copy. Exit 1 if it does not."""
    bad = []
    for name, src in sources():
        target = dest / name
        if not target.exists():
            bad.append(f"  MISSING  {name}")
        elif sha(target) != sha(src):
            bad.append(f"  STALE    {name}  (differs from wrapper/android/{name})")
        else:
            print(f"  ok       {name}")
    if bad:
        print("\n".join(bad))
        sys.exit(f"\ntools_backup_keystore: {dest} is NOT a current backup.")
    print(f"\n{dest} holds a current backup of both files.")


def backup(dest):
    dest.mkdir(parents=True, exist_ok=True)
    for name, src in sources():
        target = dest / name
        shutil.copy2(src, target)
        # Verify rather than trust the copy: a silently truncated keystore is
        # indistinguishable from a good one until the day it is needed, which
        # is the day it cannot be fixed.
        if sha(target) != sha(src):
            sys.exit(f"tools_backup_keystore: {target} does not match the original after copying.")
        print(f"  copied   {name}  ({target.stat().st_size} bytes, verified)")
    print(f"\nBacked up to {dest}")
    print("\n⚠ keystore.properties holds the store password in plain text. If that")
    print("  folder syncs to the cloud, the signing key and its password now do too.")
    print(f"\n  Re-check this copy later with:")
    print(f"    python tools_backup_keystore.py --check \"{dest}\"")


def main():
    args = sys.argv[1:]
    checking = "--check" in args
    rest = [a for a in args if a != "--check"]
    if len(rest) != 1:
        sys.exit(
            "usage:\n"
            "  python tools_backup_keystore.py <folder>           back up to <folder>\n"
            "  python tools_backup_keystore.py --check <folder>   verify an existing copy\n"
            "\n"
            "  No default destination, deliberately -- see the warning in this file's\n"
            "  docstring about where NOT to put a signing key and its password."
        )
    dest = Path(rest[0]).expanduser().resolve()
    if dest == ANDROID:
        sys.exit("tools_backup_keystore: that is where the originals live. Pick somewhere else.")
    check(dest) if checking else backup(dest)


if __name__ == "__main__":
    main()
