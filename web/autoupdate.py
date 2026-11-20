#!/usr/bin/env python3
"""Keeps the host's copy of z's horizon up to date and running.

    python web/autoupdate.py                 # serves on 8080, checks every 60 seconds
    python web/autoupdate.py 9000 --every 30 # another port and interval
    python web/autoupdate.py --deploy-worker # also `npx wrangler deploy` when the rooms Worker changed

It starts web/serve.py itself (use this instead of running serve.py). Every interval it runs `git fetch`; when
the branch has new commits it runs `git pull --ff-only`, then web/build.sh if the update touched what the build
makes (Rust crates, Cargo files, the build scripts), and only then restarts the server, so a failed build
leaves the old one running. Ctrl+C stops the server and this script.

A pull that can't go through (local edits in the way, a diverged branch) is reported once and tried again when
the remote changes. A failed build is tried again at the next check.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

WEB = Path(__file__).resolve().parent
ROOT = WEB.parent
# Changes here need web/build.sh (the WebAssembly and what is bundled with it). Everything else the
# page loads (launcher.js, site.js, ...) is served straight from web/ and needs only a restart.
BUILD_PATHS = ("crates/", ".cargo/", "Cargo.toml", "Cargo.lock", "rust-toolchain", "web/build.sh", "web/bundle.py", "web/package.py")
WORKER_PATHS = ("web/rooms-service/src/", "web/rooms-service/wrangler.toml")


def log(text: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)


def git(*args: str, check: bool = True) -> str:
    done = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if check and done.returncode:
        raise RuntimeError((done.stderr or done.stdout).strip() or f"git {' '.join(args)} failed")
    return done.stdout.strip()


def needs_build(changed: list[str]) -> bool:
    return any(path.startswith(BUILD_PATHS) for path in changed)


def worker_changed(changed: list[str]) -> bool:
    return any(path.startswith(WORKER_PATHS) for path in changed)


class Server:
    """web/serve.py (or `--serve-cmd`) as a child process that can be stopped with Ctrl+C's own signal."""

    def __init__(self, command: list[str]) -> None:
        self.command = command
        self.process: subprocess.Popen | None = None

    def start(self) -> None:
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        self.process = subprocess.Popen(self.command, cwd=ROOT, creationflags=flags)
        log(f"server started (pid {self.process.pid}): {' '.join(self.command)}")

    def stop(self) -> None:
        process, self.process = self.process, None
        if not process or process.poll() is not None:
            return
        # Ctrl+C first (what serve.py expects), then ask, then insist.
        try:
            process.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
            process.wait(timeout=3)
        except (subprocess.TimeoutExpired, ValueError, OSError):
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        log("server stopped")

    def alive(self) -> bool:
        return bool(self.process and self.process.poll() is None)


def run_build(command: list[str]) -> bool:
    log("building: " + " ".join(command))
    return subprocess.run(command, cwd=ROOT).returncode == 0


def deploy_worker() -> None:
    log("deploying the rooms Worker (npx wrangler deploy)")
    npx = shutil.which("npx") or "npx"
    if subprocess.run([npx, "wrangler", "deploy"], cwd=WEB / "rooms-service").returncode:
        log("the Worker deploy failed; run it by hand in web/rooms-service")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("port", nargs="?", default="8080", help="port for serve.py (default 8080)")
    parser.add_argument("--every", type=int, default=60, help="seconds between checks (default 60)")
    parser.add_argument("--deploy-worker", action="store_true", help="run `npx wrangler deploy` when the rooms Worker changed")
    parser.add_argument("--build-cmd", nargs="+", help="the build command (default: bash web/build.sh)")
    parser.add_argument("--serve-cmd", nargs="+", help="the server command (default: python web/serve.py PORT)")
    args = parser.parse_args()

    bash = shutil.which("bash")
    build_cmd = args.build_cmd or ([bash, "web/build.sh"] if bash else None)
    serve_cmd = args.serve_cmd or [sys.executable, str(WEB / "serve.py"), args.port]
    server = Server(serve_cmd)
    pending_build = False  # an earlier build failed: try again
    pending_worker = False
    failed_pull_for = ""  # the remote commit whose pull failed, so it is reported once
    server.start()
    log(f"checking for updates every {args.every} s on {git('rev-parse', '--abbrev-ref', '@{u}')}")
    try:
        while True:
            time.sleep(args.every)
            if not server.alive():
                log("the server stopped by itself; starting it again")
                server.start()
            try:
                git("fetch", "--quiet")
                head, remote = git("rev-parse", "HEAD"), git("rev-parse", "@{u}")
            except RuntimeError as error:
                log(f"can't check for updates: {error}")
                continue
            if head != remote and remote != failed_pull_for:
                changed = git("diff", "--name-only", "HEAD", "@{u}").splitlines()
                log(f"update found: {len(changed)} file(s) changed; pulling")
                try:
                    git("pull", "--ff-only", "--quiet")
                except RuntimeError as error:
                    failed_pull_for = remote
                    log(f"the pull didn't go through, so nothing was changed: {error}")
                    continue
                failed_pull_for = ""
                pending_build = pending_build or needs_build(changed)
                pending_worker = pending_worker or worker_changed(changed)
                log("pulled to " + git("rev-parse", "--short", "HEAD"))
            elif not pending_build and not pending_worker:
                continue
            else:
                changed = []
            restart = head != git("rev-parse", "HEAD") or pending_build or pending_worker
            if pending_build:
                if not build_cmd:
                    log("this update needs web/build.sh but bash isn't installed (use Git Bash); not restarting")
                    continue
                if run_build(build_cmd):
                    pending_build = False
                else:
                    log("the build failed; the old server keeps running and the build is tried again next check")
                    continue
            if pending_worker and args.deploy_worker:
                deploy_worker()
                pending_worker = False
            elif pending_worker:
                log("the rooms Worker changed: run `npx wrangler deploy` in web/rooms-service (or start this with --deploy-worker)")
                pending_worker = False
            if restart:
                server.stop()
                server.start()
    except KeyboardInterrupt:
        log("stopping")
    finally:
        server.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
