#!/usr/bin/env python3
"""Pack the site (without a book) into one text file, or unpack it.

    python3 tools/pack_template.py pack BUNDLE_FILE
    python3 tools/pack_template.py unpack BUNDLE_FILE TARGET_FOLDER

The bundle is how the /quiz-htrab skill stores this template in a
claude.ai project: a gzip-compressed tar archive written as base64 text
(76 characters a line), so the whole site fits in one small text file.
Unpacking needs only this script, or `base64 -d FILE | tar xz`.

Left out: questions.json (each book brings its own), the generated
theme files (`python3 tools/build_themes.py` rebuilds them after
unpacking), the working folder and caches.
"""

import base64
import io
import sys
import tarfile
import textwrap
from pathlib import Path

SITE_FOLDER = Path(__file__).resolve().parent.parent
LEFT_OUT = {"questions.json", "css/themes.css", "js/themes-list.js"}
LEFT_OUT_FOLDERS = {"__pycache__", ".git", "work"}
TOP_FOLDER = "htrab-quiz"


def files_to_pack():
    """Relative paths of every template file, sorted."""
    paths = []
    for path in sorted(SITE_FOLDER.rglob("*")):
        relative = path.relative_to(SITE_FOLDER)
        if not path.is_file() or relative.as_posix() in LEFT_OUT:
            continue
        if LEFT_OUT_FOLDERS & set(relative.parts):
            continue
        paths.append(relative)
    return paths


def pack(bundle_file):
    """Write every template file into the bundle."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for relative in files_to_pack():
            archive.add(SITE_FOLDER / relative,
                        arcname=f"{TOP_FOLDER}/{relative.as_posix()}")
    text = textwrap.fill(base64.b64encode(buffer.getvalue()).decode(), 76)
    Path(bundle_file).write_text(text + "\n")
    print(f"Packed {len(files_to_pack())} files into {bundle_file}")


def unpack(bundle_file, target_folder):
    """Write the bundle's files into target_folder."""
    data = base64.b64decode(Path(bundle_file).read_text())
    target = Path(target_folder).resolve()
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            relative = Path(member.name).relative_to(TOP_FOLDER)
            destination = (target / relative).resolve()
            if target not in destination.parents:
                raise SystemExit(f"Unsafe path in bundle: {member.name}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(member).read())
    print(f"Unpacked into {target}")


def main():
    """Read the command line and pack or unpack."""
    arguments = sys.argv[1:]
    if len(arguments) == 2 and arguments[0] == "pack":
        pack(arguments[1])
    elif len(arguments) == 3 and arguments[0] == "unpack":
        unpack(arguments[1], arguments[2])
    else:
        print(__doc__)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
