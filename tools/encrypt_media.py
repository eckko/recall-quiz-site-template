#!/usr/bin/env python3
"""Encrypt media files for a book, one file at a time (template v2).

    python3 tools/encrypt_media.py KEYFILE ID SOURCE [ID SOURCE ...]
            [--out media] [--make-key]

KEYFILE holds the book key (32 random bytes, base64). The word
"placeholder" stands for a public stand-in key (the SHA-256 of
"key-placeholder"): files hidden with it are not secret, but
tools/reencrypt_media.py can later swap them to the real key. With --make-key a
new key is written to KEYFILE first (it refuses to overwrite one). Keep
the key out of the repo. Each ID looks like u03/i07/f02 and SOURCE is the
file to hide; the result is <out>/<ID>.enc, which media-store.js opens.

The file format is the 12-byte nonce followed by AES-GCM data. The file
key comes from the book key with HKDF-SHA-256 (info "file:<ID>"); the ID
is the authenticated data. The nonce is a keyed hash of the content, so
the same file always gives the same bytes and git stores nothing new when
a book is rebuilt.

Prints a size report and stops when a file is too big (see LIMITS).
"""

import base64
import hashlib
import hmac
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

NONCE_BYTES = 12
LIMITS = {"one file": 50_000_000, "book": 100_000_000}
WARN_FILE = 3_000_000


PLACEHOLDER_TEXT = "key-placeholder"


def placeholder_key():
    """The public stand-in key: SHA-256 of the text 'key-placeholder'."""
    return hashlib.sha256(PLACEHOLDER_TEXT.encode()).digest()


def decrypt(book_key, file_id, data):
    """The original bytes of one stored file; raises if the key or id is
    wrong."""
    file_key = derive(book_key, "file:" + file_id, 32)
    return AESGCM(file_key).decrypt(
        data[:NONCE_BYTES], data[NONCE_BYTES:], file_id.encode())


def derive(book_key, info, length):
    """HKDF-SHA-256 of the book key for one purpose."""
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=None,
                info=info.encode()).derive(book_key)


def encrypt(book_key, file_id, content):
    """The bytes to store for one file."""
    file_key = derive(book_key, "file:" + file_id, 32)
    nonce_key = derive(book_key, "nonce:" + file_id, 32)
    nonce = hmac.new(nonce_key, content, hashlib.sha256).digest()[
        :NONCE_BYTES]
    sealed = AESGCM(file_key).encrypt(nonce, content, file_id.encode())
    return nonce + sealed


def read_key(path, make):
    """The book key; with make, create the key file first."""
    if path == "placeholder":
        return placeholder_key()
    key_path = Path(path)
    if make:
        if key_path.exists():
            sys.exit(f"{path} already exists; not overwriting a key")
        key_path.write_text(base64.b64encode(os.urandom(32)).decode())
        key_path.chmod(0o600)
        print(f"Wrote a new key to {path}. Back it up; never commit it.")
    return base64.b64decode(key_path.read_text().strip())


def main():
    """Encrypt every ID/SOURCE pair named on the command line."""
    args = sys.argv[1:]
    make = "--make-key" in args
    out = Path(args[args.index("--out") + 1]) if "--out" in args else \
        Path("media")
    rest = [a for i, a in enumerate(args) if a != "--make-key" and a != "--out"
            and (i == 0 or args[i - 1] != "--out")]
    if len(rest) < 3 or len(rest) % 2 == 0:
        print(__doc__)
        sys.exit(2)
    book_key = read_key(rest[0], make)
    total = 0
    for file_id, source in zip(rest[1::2], rest[2::2]):
        content = Path(source).read_bytes()
        if len(content) > LIMITS["one file"]:
            sys.exit(f"{source} is {len(content):,} bytes: too big")
        if len(content) > WARN_FILE:
            print(f"warning: {source} is over {WARN_FILE:,} bytes")
        target = out / (file_id + ".enc")
        target.parent.mkdir(parents=True, exist_ok=True)
        data = encrypt(book_key, file_id, content)
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
        total += len(data)
        print(f"  {file_id}.enc  {len(data):,} bytes")
    if total > LIMITS["book"]:
        sys.exit(f"{total:,} bytes in this run is over the book limit")
    print(f"{len(rest[1::2])} file(s), {total:,} bytes")


if __name__ == "__main__":
    main()
