#!/usr/bin/env python3
"""
Serve html_new static files and proxy /gcmatch/* → GC Match API (fixes browser CORS).

  python opm-dev-server.py
  # open http://127.0.0.1:8765/index.html
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
GCMATCH_UPSTREAM = os.environ.get(
    "GCMATCH_UPSTREAM",
    "https://con-gcmatch.blueplant-16804982.westus2.azurecontainerapps.io",
).rstrip("/")
GCMATCH_API_KEY = os.environ.get(
    "GCMATCH_API_KEY",
    "15593112-974f-4e39-893f-5a7c5e4756a1",
)
PORT = int(os.environ.get("OPM_DEV_PORT", "8765"))
PROXY_PREFIX = "/gcmatch"


def add_cors(handler: SimpleHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, Accept, x-api-key",
    )


class OpmDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self) -> None:
        add_cors(self)
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if self.path.startswith(PROXY_PREFIX):
            self.send_response(204)
            self.end_headers()
            return
        super().do_OPTIONS()

    def _proxy_to_gcmatch(self) -> None:
        upstream_path = self.path[len(PROXY_PREFIX) :] or "/"
        if "?" in upstream_path:
            path, query = upstream_path.split("?", 1)
            target = f"{GCMATCH_UPSTREAM}{path}?{query}"
        else:
            target = f"{GCMATCH_UPSTREAM}{upstream_path}"

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None

        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = self.headers.get(
                "Content-Type", "application/json"
            )
        api_key = self.headers.get("x-api-key") or GCMATCH_API_KEY
        if api_key:
            headers["x-api-key"] = api_key

        req = urllib.request.Request(
            target,
            data=body,
            headers=headers,
            method=self.command,
        )

        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                ctype = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as err:
            payload = err.read()
            self.send_response(err.code)
            self.send_header(
                "Content-Type",
                err.headers.get("Content-Type", "application/json"),
            )
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:
            msg = json.dumps({"detail": str(exc)}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self) -> None:
        if self.path.startswith(PROXY_PREFIX):
            self._proxy_to_gcmatch()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path.startswith(PROXY_PREFIX):
            self._proxy_to_gcmatch()
            return
        super().do_POST()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), OpmDevHandler)
    print(f"Serving {ROOT}")
    print(f"  UI:    http://127.0.0.1:{PORT}/index.html")
    print(f"  Proxy: http://127.0.0.1:{PORT}{PROXY_PREFIX}/ → {GCMATCH_UPSTREAM}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
