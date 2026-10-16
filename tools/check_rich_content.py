"""Checks for the template v2 fields of a teaching bank.

Used by validate_bank.py. Each function returns a list of
(level, message) pairs, where level is "error" or "warn". The fields are
described in ai-context/data-formats.md ("Template v2 fields").
"""

import re

MEDIA_ROLES = ("figure", "illustration", "cover", "logo", "decorative",
               "animation", "clip")
MEDIA_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$")
SOURCE_USES = ("paraphrase", "quotes", "quotes+images")
MEDIA_STORES = ("repo",)
MOST_BLOCKS = 6
MOST_STUDY_BLOCKS = 8     # a card with verse-study blocks
MOST_VERSE_LINES = 4
MOST_WORDS_PER_LINE = 30
PART_KEYS = ("ref", "verse", "words", "hindi", "english", "explain",
             "aids", "note")
MOST_AIDS = 14            # memory aids on one card
MOST_AID_STEPS = 8
MOST_AID_GROUPS = 4
MOST_AID_GROUP_ITEMS = 12
MOST_AID_WORDS = 60
AID_ID = re.compile(r"^[a-z]+(-[a-z]+)*$")
IAST_MARKS = re.compile("[āīūṛṝḷṅñṭḍṇśṣṃḥ]")
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


def block_limit(blocks):
    """6 blocks, or 8 when the card has a verse-study block."""
    studied = isinstance(blocks, list) and any(
        isinstance(block, dict) and block.get("study") for block in blocks)
    return MOST_STUDY_BLOCKS if studied else MOST_BLOCKS


def check_blocks(blocks):
    """card.blocks: labelled parts of a card."""
    limit = block_limit(blocks)
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= limit:
        return [("error", f"card.blocks needs 1 to {limit} blocks")]
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
                or block.get("media") or block.get("lines")
                or block.get("words") or block.get("aids")):
            found.append(("error", f"{label}: needs text, code, media, "
                          "lines, words or aids"))
        found.extend(check_study(label, block))
        if "aids" in block:
            found.extend((level, f"{label}: {message}") for level, message
                         in check_aids(block["aids"]))
        found.extend(check_extras(label, block))
    return found


def check_study(label, block):
    """study, key, lines and words on a block (verse-study cards)."""
    found = []
    if "key" in block and block["key"] not in PART_KEYS:
        found.append(("error", f"{label}: key must be one of "
                      + ", ".join(PART_KEYS)))
    if "study" in block and not isinstance(block["study"], bool):
        found.append(("error", f"{label}: study must be true or false"))
    if "lines" in block:
        lines = block["lines"]
        if not (isinstance(lines, list) and 1 <= len(lines) <=
                MOST_VERSE_LINES and all(is_text(x) for x in lines)):
            found.append(("error", f"{label}: lines must be 1 to "
                          f"{MOST_VERSE_LINES} non-empty texts"))
    if "words" in block:
        found.extend((level, f"{label}: {message}") for level, message in
                     check_words(block["words"]))
    if block.get("study"):
        found.extend(check_script(label, block))
    return found


def check_aids(aids):
    """block.aids: memory aids a reader can switch on or off by kind."""
    if not isinstance(aids, list) or not 1 <= len(aids) <= MOST_AIDS:
        return [("error", f"aids needs 1 to {MOST_AIDS} items")]
    found = []
    seen = set()
    for position, item in enumerate(aids, start=1):
        label = f"aid #{position}"
        if not isinstance(item, dict):
            found.append(("error", f"{label} must be an object"))
            continue
        kind = item.get("aid")
        if not (is_text(kind) and AID_ID.match(kind)):
            found.append(("error", f"{label}: aid must be a lower-case "
                          "word, such as chain or pegs"))
        elif kind in seen:
            found.append(("error", f"{label}: {kind!r} is used twice on "
                          "one card"))
        else:
            seen.add(kind)
        if not is_text(item.get("label")):
            found.append(("error", f"{label}: label is required"))
        found.extend(check_aid_content(label, item))
    return found


def check_aid_content(label, item):
    """An aid has text, steps, groups or lines (at least one)."""
    found = []
    shapes = [k for k in ("text", "steps", "groups", "lines")
              if item.get(k)]
    if not shapes:
        return [("error", f"{label}: needs text, steps, groups or lines")]
    if "text" in item:
        if not is_text(item["text"]):
            found.append(("error", f"{label}: text must be text"))
        elif len(item["text"].split()) > MOST_AID_WORDS:
            found.append(("warn", f"{label}: text is longer than "
                          f"{MOST_AID_WORDS} words; a memory aid is short"))
    if "steps" in item:
        steps = item["steps"]
        if not (isinstance(steps, list) and 2 <= len(steps) <=
                MOST_AID_STEPS and all(is_text(x) for x in steps)):
            found.append(("error", f"{label}: steps must be 2 to "
                          f"{MOST_AID_STEPS} non-empty texts"))
    if "lines" in item:
        lines = item["lines"]
        if not (isinstance(lines, list) and 1 <= len(lines) <=
                MOST_VERSE_LINES and all(is_text(x) for x in lines)):
            found.append(("error", f"{label}: lines must be 1 to "
                          f"{MOST_VERSE_LINES} non-empty texts"))
    if "image" in item:
        found.extend(check_aid_image(label, item["image"]))
    if "groups" in item:
        groups = item["groups"]
        ok = isinstance(groups, list) and 1 <= len(groups) <= MOST_AID_GROUPS
        for group in groups if ok else []:
            ok = ok and isinstance(group, dict) and is_text(
                group.get("label")) and isinstance(
                group.get("items"), list) and 1 <= len(
                group["items"]) <= MOST_AID_GROUP_ITEMS and all(
                is_text(x) for x in group["items"])
        if not ok:
            found.append(("error", f"{label}: groups must be 1 to "
                          f"{MOST_AID_GROUPS} of {{label, items}} with 1 to "
                          f"{MOST_AID_GROUP_ITEMS} texts each"))
    return found


def check_aid_image(label, image):
    """aid.image: a picture of the book's own, with words for it."""
    if not isinstance(image, dict):
        return [("error", f"{label}: image must be {{src, alt}}")]
    found = []
    src = image.get("src")
    if not (is_text(src) and re.match(r"^[\w./-]+\.(svg|png|jpg|webp)$", src)
            and not src.startswith(("/", "..")) and "://" not in src):
        found.append(("error", f"{label}: image.src must be a file in this "
                      "book, such as images/aids/chain.svg"))
    alt = image.get("alt")
    if not is_text(alt) or len(alt.split()) < LEAST_ALT_WORDS:
        found.append(("error", f"{label}: image.alt needs at least "
                      f"{LEAST_ALT_WORDS} words, so the picture can be "
                      "understood without seeing it"))
    return found


def check_script(label, block):
    """Verse lines and word forms are Devanagari, not romanised (IAST)."""
    texts = list(block.get("lines") or [])
    for row in block.get("words") or []:
        if isinstance(row, list):
            texts += [word.get("w", "") for word in row
                      if isinstance(word, dict)]
    if any(isinstance(text, str) and IAST_MARKS.search(text)
           for text in texts):
        return [("warn", f"{label}: verse lines or word forms contain "
                 "romanised (IAST) letters; use Devanagari")]
    return []


def check_words(rows):
    """words: one list of {w, gloss, gram} per verse line."""
    if not isinstance(rows, list) or not rows:
        return [("error", "words must be a non-empty list of lines")]
    found = []
    for number, row in enumerate(rows, start=1):
        if not (isinstance(row, list) and 1 <= len(row) <=
                MOST_WORDS_PER_LINE):
            found.append(("error", f"words line {number} needs 1 to "
                          f"{MOST_WORDS_PER_LINE} words"))
            continue
        for word in row:
            if not (isinstance(word, dict) and is_text(word.get("w"))
                    and is_text(word.get("gloss"))):
                found.append(("error", f"words line {number}: each word "
                              "needs w and gloss"))
            elif "gram" in word and not isinstance(word["gram"], str):
                found.append(("error", f"words line {number}: gram must "
                              "be text"))
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
    if "cover" in bank:
        cover = bank["cover"]
        if not isinstance(cover, dict):
            found.append(("error", "cover must be one media entry"))
        else:
            found.extend((level, f"cover: {message}") for level, message in
                         check_media_entry("media", cover))
    return found


def block_texts(card):
    """The words in a card's blocks, for the key-term check."""
    blocks = card.get("blocks")
    if not isinstance(blocks, list):
        return []
    found = []
    for block in blocks:
        if isinstance(block, dict):
            found.append(block.get("text"))
            found.extend(block.get("lines") or [])
            for aid in block.get("aids") or []:
                if isinstance(aid, dict):
                    found.append(aid.get("text"))
                    found.extend(aid.get("steps") or [])
                    found.extend(aid.get("lines") or [])
            found.extend(word.get("w", "") + " " + word.get("gloss", "")
                         for row in block.get("words") or []
                         if isinstance(row, list)
                         for word in row if isinstance(word, dict))
    return [text for text in found if is_text(text)]
