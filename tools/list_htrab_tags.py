#!/usr/bin/env python3
"""Print the HTRAB tags a bank can use, so writers copy them exactly.

    python3 tools/list_htrab_tags.py [--level analytical] [--chapter 6]
                                     [--testable]

Each line is a full tag, "level/topic/subtopic", followed by the
subtopic's title. Tags come from htrab/tags.json. A tag that is not in
that file fails validation, so copy tags from this list, never type them
from memory.

--level     only one level (inspectional, analytical, ...)
--chapter   only topics from one chapter of How to Read a Book
--testable  leave out subtopics that are not testable
"""

import argparse
import json
from pathlib import Path

TAGS_FILE = Path(__file__).resolve().parent.parent / "htrab" / "tags.json"


def load_tags():
    """Read htrab/tags.json and return the parsed dictionary."""
    return json.loads(TAGS_FILE.read_text())


def all_tags(tree, level=None, chapter=None, testable_only=False):
    """List (tag, title, testable, chapter) for every subtopic.

    @param tree  the parsed tags.json
    @param level  keep only this level id, or None
    @param chapter  keep only this chapter number, or None
    @param testable_only  drop subtopics marked not testable
    @returns list of tuples
    """
    found = []
    for level_entry in tree["levels"]:
        if level and level_entry["id"] != level:
            continue
        for topic in level_entry["topics"]:
            if chapter is not None and topic.get("chapter") != chapter:
                continue
            for sub in topic["subtopics"]:
                if testable_only and not sub.get("testable"):
                    continue
                tag = "/".join((level_entry["id"], topic["id"], sub["id"]))
                found.append((tag, sub["label"], sub.get("testable", False),
                              topic.get("chapter")))
    return found


def main():
    """Read the command line and print the matching tags."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--level")
    parser.add_argument("--chapter", type=int)
    parser.add_argument("--testable", action="store_true")
    arguments = parser.parse_args()
    tags = all_tags(load_tags(), arguments.level, arguments.chapter,
                    arguments.testable)
    for tag, title, testable, chapter in tags:
        flag = "" if testable else "  (not testable)"
        print(f"{tag}\n    ch.{chapter}: {title}{flag}")
    print(f"{len(tags)} tag(s)")


if __name__ == "__main__":
    main()
