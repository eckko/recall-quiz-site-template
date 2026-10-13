"""Checks for the template v2 fields of a teaching bank.

Used by validate_bank.py. Each function returns a list of
(level, message) pairs, where level is "error" or "warn". The fields are
described in ai-context/data-formats.md ("Template v2 fields").
"""

import re

MEDIA_ROLES = ("figure", "cover", "logo", "decorative", "animation",
               "clip")
MEDIA_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$")
SOURCE_USES = ("paraphrase", "quotes", "quotes+images")
MEDIA_STORES = ("repo",)
MOST_BLOCKS = 6
MOST_CODE_LINES = 40
MOST_LABEL_CHARS = 40
MOST_GENRE_CHARS = 30
LEAST_ALT_WORDS = 4


def is_text(value):
    """True for a non-empty string."""
    return isinstance(value, str) and bool(value.strip())


def check_code(code, lang):
    """A code listing and its optional language name."""
    found = []
    if not is_text(code):
        return [("error", "code must be non-empty text")]
    if code.count("\n") + 1 > MOST_CODE_LINES:
        found.append(("warn", f"code has over {MOST_CODE_LINES} lines"))
    if lang is not None and not (is_text(lang) and len(lang) <= 20):
        found.append(("error", "lang must be a short name such as 'java'"))
    return found


def check_media(media):
    """A list of media entries: [{id or src, alt, role, type}]."""
    if not isinstance(media, list) or not media:
        return [("error", "media must be a non-empty list")]
    found = []
    for position, entry in enumerate(media, start=1):
        label = f"media #{position}"
        if not isinstance(entry, dict):
            found.append(("error", f"{label} must be an object"))
            continue
        found.extend(check_media_entry(label, entry))
    return found


def check_media_entry(label, entry):
    """One media entry."""
    found = []
    identifier, source = entry.get("id"), entry.get("src")
    if bool(identifier) == bool(source):
        found.append(("error", f"{label}: give either id or src"))
    elif identifier and not (isinstance(identifier, str)
                             and MEDIA_ID.match(identifier)):
        found.append(("error", f"{label}: id {identifier!r} must look "
                      "like u03/i07/f02"))
    elif source and not is_text(source):
        found.append(("error", f"{label}: src must be text"))
    role = entry.get("role", "figure")
    if role not in MEDIA_ROLES:
        found.append(("error", f"{label}: role {role!r} is not one of "
                      f"{', '.join(MEDIA_ROLES)}"))
    kind = entry.get("type")
    if kind is not None and not (isinstance(kind, str) and
                                 re.match(r"^(image|video)/[\w.+-]+$", kind)):
        found.append(("error", f"{label}: type must be image/... or "
                      "video/..."))
    if role != "decorative":
        alt = entry.get("alt")
        if not is_text(alt):
            found.append(("error", f"{label}: alt (the words that stand "
                          "in for the picture) is required"))
        elif len(alt.split()) < LEAST_ALT_WORDS:
            found.append(("warn", f"{label}: alt has under "
                          f"{LEAST_ALT_WORDS} words; a reader without the "
                          "picture needs more"))
    return found


def check_blocks(blocks):
    """card.blocks: labelled parts of a card."""
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= MOST_BLOCKS:
        return [("error", f"card.blocks needs 1 to {MOST_BLOCKS} blocks")]
    found = []
    for position, block in enumerate(blocks, start=1):
        label = f"block #{position}"
        if not isinstance(block, dict):
            found.append(("error", f"{label} must be an object"))
            continue
        name = block.get("label")
        if not is_text(name) or len(name) > MOST_LABEL_CHARS:
            found.append(("error", f"{label}: label is required "
                          f"({MOST_LABEL_CHARS} characters at most)"))
        if not (is_text(block.get("text")) or is_text(block.get("code"))
                or block.get("media")):
            found.append(("error", f"{label}: needs text, code or media"))
        found.extend(check_extras(label, block))
    return found


def check_extras(label, thing):
    """code, lang and media on a question or a block."""
    found = []
    if "code" in thing:
        found += [(level, f"{label}: {message}") for level, message in
                  check_code(thing["code"], thing.get("lang"))]
    if "media" in thing:
        found += [(level, f"{label}: {message}") for level, message in
                  check_media(thing["media"])]
    return found


def check_genre(genre):
    """concept.genre or the book's genre: a short label."""
    if is_text(genre) and len(genre) <= MOST_GENRE_CHARS:
        return []
    return [("error", f"genre must be a short label "
             f"({MOST_GENRE_CHARS} characters at most)")]


def check_book_settings(bank):
    """Top-level sourceUse, mediaStore and genre."""
    found = []
    use = bank.get("sourceUse", "paraphrase")
    if use not in SOURCE_USES:
        found.append(("error", f"sourceUse {use!r} is not one of "
                      f"{', '.join(SOURCE_USES)}"))
    if bank.get("mediaStore", "repo") not in MEDIA_STORES:
        found.append(("error", "mediaStore must be 'repo'"))
    if "genre" in bank:
        found.extend(check_genre(bank["genre"]))
    return found


def block_texts(card):
    """The words in a card's blocks, for the key-term check."""
    blocks = card.get("blocks")
    if not isinstance(blocks, list):
        return []
    return [block.get("text") for block in blocks
            if isinstance(block, dict) and is_text(block.get("text"))]
