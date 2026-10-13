#!/usr/bin/env python3
"""Move a book's encrypted media from one key to another (template v2).

    python3 tools/reencrypt_media.py OLD_KEY NEW_KEY [--media media]

OLD_KEY and NEW_KEY are key files (32 random bytes, base64), or the word
"placeholder" for the public stand-in key. Every media/<id>.enc is opened
with OLD_KEY and written again with NEW_KEY. The nonce depends only on the
key and the content, so running it twice changes nothing, and a file
that already opens with NEW_KEY is left alone.

Typical use: the files were made with "placeholder"; run
    python3 tools/reencrypt_media.py placeholder ../keys/my-book.key
and commit the result. Keep NEW_KEY out of the repo and put the same key
in Firebase (users/<uid>/mediaKeys/<book id>).
"""

import sys
from pathlib import Path

from cryptography.exceptions import InvalidTag

import encrypt_media


def main():
    """Re-encrypt every .enc file under the media folder."""
    args = sys.argv[1:]
    folder = Path("media")
    if "--media" in args:
        position = args.index("--media")
        folder = Path(args[position + 1])
        del args[position:position + 2]
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    old_key = encrypt_media.read_key(args[0], False)
    new_key = encrypt_media.read_key(args[1], False)
    if old_key == new_key:
        sys.exit("OLD_KEY and NEW_KEY are the same key; nothing to do")
    changed = kept = 0
    for path in sorted(folder.rglob("*.enc")):
        file_id = path.relative_to(folder).with_suffix("").as_posix()
        data = path.read_bytes()
        try:
            content = encrypt_media.decrypt(old_key, file_id, data)
        except InvalidTag:
            try:
                encrypt_media.decrypt(new_key, file_id, data)
                kept += 1
                continue
            except InvalidTag:
                sys.exit(f"{path} opens with neither key; stopped before "
                         "changing anything else")
        path.write_bytes(encrypt_media.encrypt(new_key, file_id, content))
        changed += 1
    print(f"{changed} file(s) moved to the new key, {kept} already on it")


if __name__ == "__main__":
    main()
