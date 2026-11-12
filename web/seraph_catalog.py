#!/usr/bin/env python3
"""Builds web/catalog.json, the launcher's games and apps lists, from a checkout of seraph.

The games and apps themselves stay in the seraph repo (4.7 GB of games): the launcher
lists them from this small file and loads each one from where seraph is hosted
(SERAPH_URL in web/config.js).

Usage: seraph_catalog.py SERAPH_CHECKOUT [OUT]
"""

import html
import json
import re
import sys
from pathlib import Path

ENTRY = re.compile(
    r'<a[^>]*href="([^"]+)"[^>]*>\s*<div class="button"([^>]*)>\s*<h2>(.*?)</h2>(?:\s*<p>(.*?)</p>)?',
    re.S,
)
THUMB = re.compile(r"url\('?\"?\.\./([^')\"]+)")
GENRE = re.compile(r'data-genre="([^"]*)"')
# Seraph's own genre filter, and the odd spellings its list has.
GENRES = {"adventure", "arcade", "mobile", "platformer", "puzzle", "simulation"}
FIX = {"aracde": "arcade", "simulator": "simulation"}


def clean(text: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", text)).split())


def parse(page: Path, folder: str, genres: bool) -> list[dict]:
    items, seen = [], set()
    for href, attrs, name, desc in ENTRY.findall(page.read_text(encoding="utf-8", errors="replace")):
        if href.startswith(("http:", "https:", "../")) or not href.endswith("/index.html"):
            continue
        ident = href.split("/")[0]
        thumb = THUMB.search(attrs)
        if ident in seen or not thumb:
            continue
        seen.add(ident)
        item = {"id": ident, "name": clean(name), "path": f"{folder}/{href}", "thumb": thumb.group(1)}
        if genres:
            found = GENRE.search(attrs)
            genre = FIX.get(found.group(1), found.group(1)) if found else ""
            item["genre"] = genre if genre in GENRES else "other"
        elif desc:
            item["desc"] = clean(desc)
        items.append(item)
    return sorted(items, key=lambda i: i["name"].lower())


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent / "catalog.json"
    games = parse(root / "games" / "index.html", "games", True)
    apps = parse(root / "apps" / "index.html", "apps", False)
    for kind, items in (("games", games), ("apps", apps)):
        missing = [i["path"] for i in items if not (root / i["path"]).is_file()]
        if missing:
            print(f"warning: {len(missing)} {kind} listed but missing from the checkout, e.g. {missing[:3]}", file=sys.stderr)
    out.write_text(json.dumps({"games": games, "apps": apps}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{out}: {len(games)} games, {len(apps)} apps")


if __name__ == "__main__":
    main()
