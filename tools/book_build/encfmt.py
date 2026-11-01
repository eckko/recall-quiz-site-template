"""Encrypted file format used by the trial (and proposed for the template).

  bytes 0-3   magic  b"RQE1"
  byte  4     flags  bit0 = payload was gzipped before encryption
  bytes 5-8   key id (ascii, 4 chars), so keys can rotate or be mixed
  bytes 9-20  nonce (12 random bytes)
  bytes 21-   AES-256-GCM ciphertext + 16 byte tag (key id is authenticated)
"""
import gzip, os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"RQE1"


def load_key(path):
    return bytes.fromhex(open(path).read().strip())


def encrypt(data, key, kid="s001", compress=True):
    flags = 1 if compress else 0
    if compress:
        data = gzip.compress(data, 9, mtime=0)
    head = MAGIC + bytes([flags]) + kid.encode("ascii")
    nonce = os.urandom(12)
    return head + nonce + AESGCM(key).encrypt(nonce, data, head)


def decrypt(blob, key):
    head, nonce, body = blob[:9], blob[9:21], blob[21:]
    assert head[:4] == MAGIC, "not an RQE1 file"
    data = AESGCM(key).decrypt(nonce, body, head)
    return gzip.decompress(data) if head[4] & 1 else data
