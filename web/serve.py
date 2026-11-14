#!/usr/bin/env python3
"""Serves web/dist on http://localhost:8080 for testing (the launcher's files from web/).

The headers make the page cross-origin isolated, which the browser requires
before it lets a page share memory between threads (needed once the game's
workers run in Web Workers).
"""

import functools
import http.server
import sys
import urllib.parse
from pathlib import Path

WEB = Path(__file__).resolve().parent
# The page's own files are served straight from web/, so an edit (config.js above
# all) shows on reload without rebuilding, and a dist built before the launcher
# existed still works: build.sh only copies these into dist for hosting.
# Everything else (the WebAssembly, the resources) comes from dist.
LIVE = {
    "index.html", "game.html", "launcher.js", "launcher.css", "config.js", "presence.js", "settings.js",
    "catalog.json", "main.js", "audio.js", "worker.js", "sw.js",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
    }

    def translate_path(self, path):
        name = urllib.parse.unquote(urllib.parse.urlsplit(path).path).lstrip("/") or "index.html"
        if name in LIVE and (WEB / name).is_file():
            return str(WEB / name)
        return super().translate_path(path)

    def end_headers(self):
        # The launcher (index.html) embeds other sites, which an isolated page
        # would block: only the game's page (game.html) and what it loads are isolated.
        if self.path.split("?")[0] not in ("/", "/index.html"):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        pass

    def log_request(self, code="-", size="-"):
        # Only failures. A request that 404s shows up here; one that never
        # appears reached some other server (a tunnel pointed at the wrong port).
        if str(code)[:1] in "45":
            print(f"{code} {self.command} {self.path}", flush=True)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = Path(__file__).resolve().parent / "dist"
    handler = functools.partial(Handler, directory=str(root))
    for rel in ("pkg/horizon-client_bg.wasm", "fs/boot.tar.gz", "build.json"):
        if not (root / rel).is_file():
            print(f"warning: {root / rel} is missing: run web/build.sh", flush=True)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Serving {root} on http://localhost:{port}")
        server.serve_forever()


if __name__ == "__main__":
    main()
