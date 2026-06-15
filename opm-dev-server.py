#!/usr/bin/env python3
"""
Serve html_new static files and proxy API routes (fixes browser CORS).

  python opm-dev-server.py
  # Prod: http://127.0.0.1:8765/prod/index.html
  # Dev:  http://127.0.0.1:8765/dev/index.html

Parts Match auth (Azure Easy Auth): copy AppServiceAuthSession into
.env.partsmatch.local (see .env.partsmatch.local.example) or set env:

  set PARTSMATCH_AUTH_COOKIE=AppServiceAuthSession=...
  python opm-dev-server.py
"""
from __future__ import annotations

import json
import os
import socket
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
GCMATCH_UPSTREAM = os.environ.get(
    "GCMATCH_UPSTREAM",
    "https://con-gcmatch.blueplant-16804982.westus2.azurecontainerapps.io",
).rstrip("/")
PARTSMATCH_UPSTREAM = os.environ.get(
    "PARTSMATCH_UPSTREAM",
    "https://ca-partsmatch.wonderfulbay-075ecb42.eastus2.azurecontainerapps.io",
).rstrip("/")
GCMATCH_API_KEY = os.environ.get(
    "GCMATCH_API_KEY",
    "15593112-974f-4e39-893f-5a7c5e4756a1",
)
PORT = int(os.environ.get("OPM_DEV_PORT", "8765"))
GCMATCH_PREFIX = "/gcmatch"
PARTSMATCH_PREFIX = "/partsmatch"
PARTSMATCH_LOCAL_ENV = os.path.join(ROOT, ".env.partsmatch.local")


def normalize_partsmatch_auth_cookie(raw: str) -> str:
    """Accept common paste mistakes from browser DevTools."""
    value = raw.strip()
    if not value:
        return ""

    # Whole value wrapped in quotes: 'AppServiceAuthSession=...'
    if (
        (value.startswith("'") and value.endswith("'"))
        or (value.startswith('"') and value.endswith('"'))
    ) and value.count("=") >= 2:
        value = value[1:-1].strip()

    # AppServiceAuthSession='AppServiceAuthSession=token...'
    wrapped = "AppServiceAuthSession='"
    if value.startswith(wrapped):
        inner = value[len(wrapped) :]
        if inner.endswith("'"):
            inner = inner[:-1]
        value = inner if inner.startswith("AppServiceAuthSession=") else (
            "AppServiceAuthSession=" + inner
        )

    if not value.startswith("AppServiceAuthSession="):
        value = "AppServiceAuthSession=" + value.strip("'\"")

    return value.strip()


def load_partsmatch_auth_cookie() -> tuple[str, str]:
    """Return (cookie, source) where source is 'file', 'env', or ''."""
    if os.path.isfile(PARTSMATCH_LOCAL_ENV):
        try:
            with open(PARTSMATCH_LOCAL_ENV, encoding="utf-8-sig") as handle:
                for line in handle:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    if key.strip() == "PARTSMATCH_AUTH_COOKIE":
                        cookie = normalize_partsmatch_auth_cookie(value)
                        if cookie:
                            return cookie, "file"
        except OSError:
            pass

    direct = os.environ.get("PARTSMATCH_AUTH_COOKIE", "").strip()
    if direct:
        return normalize_partsmatch_auth_cookie(direct), "env"

    return "", ""


def probe_partsmatch_auth(cookie: str) -> tuple[bool, int]:
    """POST a tiny match request; return (ok, http_status)."""
    if not cookie:
        return False, 0

    target = f"{PARTSMATCH_UPSTREAM}/api/match"
    body = json.dumps({"sku": "N4100", "include_obsolete": False}).encode()
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Workspace-Id": "gems-setra",
        "Cookie": cookie,
        "User-Agent": "opm-dev-server/1.0",
    }
    req = urllib.request.Request(target, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
            return True, resp.status
    except urllib.error.HTTPError as err:
        err.read()
        return False, err.code
    except Exception:
        return False, 0


def ensure_port_available(host: str, port: int) -> None:
    """Fail fast if another opm-dev-server (or anything) owns the port."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        probe.bind((host, port))
    except OSError:
        print(
            f"\nERROR: Port {port} is already in use on {host}.\n"
            "Another opm-dev-server is probably still running.\n"
            "PowerShell — stop all listeners on this port, then restart:\n\n"
            f"  Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue `\n"
            "    | Select-Object -ExpandProperty OwningProcess -Unique `\n"
            "    | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }\n"
            "  python opm-dev-server.py\n",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    finally:
        probe.close()


def add_cors(handler: SimpleHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header(
        "Access-Control-Allow-Headers",
        "Content-Type, Accept, x-api-key, X-Workspace-Id",
    )


class OpmDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self) -> None:
        add_cors(self)
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if self.path.startswith(GCMATCH_PREFIX) or self.path.startswith(
            PARTSMATCH_PREFIX
        ):
            self.send_response(204)
            self.end_headers()
            return
        super().do_OPTIONS()

    def _proxy(
        self,
        prefix: str,
        upstream: str,
        *,
        forward_api_key: bool = False,
        forward_workspace: bool = False,
        forward_cookie: bool = False,
    ) -> None:
        upstream_path = self.path[len(prefix) :] or "/"
        if "?" in upstream_path:
            path, query = upstream_path.split("?", 1)
            target = f"{upstream}{path}?{query}"
        else:
            target = f"{upstream}{upstream_path}"

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None

        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = self.headers.get(
                "Content-Type", "application/json"
            )
        if forward_api_key:
            api_key = self.headers.get("x-api-key") or GCMATCH_API_KEY
            if api_key:
                headers["x-api-key"] = api_key
        if forward_workspace:
            workspace = self.headers.get("X-Workspace-Id") or "gems-setra"
            headers["X-Workspace-Id"] = workspace
        if forward_cookie:
            auth_cookie, _source = load_partsmatch_auth_cookie()
            if auth_cookie:
                headers["Cookie"] = auth_cookie
            else:
                cookie = self.headers.get("Cookie")
                if cookie:
                    headers["Cookie"] = cookie

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

    def _partsmatch_auth_check(self) -> None:
        cookie, source = load_partsmatch_auth_cookie()
        ok, status = probe_partsmatch_auth(cookie)
        payload = json.dumps(
            {
                "ok": ok,
                "upstream_status": status,
                "cookie_source": source or None,
                "cookie_length": len(cookie),
                "hint": (
                    None
                    if ok
                    else "Refresh AppServiceAuthSession in .env.partsmatch.local "
                    "(Parts Match site → Network → POST /api/match). "
                    "If you set $env:PARTSMATCH_AUTH_COOKIE earlier, remove it."
                ),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _proxy_to_gcmatch(self) -> None:
        self._proxy(
            GCMATCH_PREFIX,
            GCMATCH_UPSTREAM,
            forward_api_key=True,
        )

    def _proxy_to_partsmatch(self) -> None:
        self._proxy(
            PARTSMATCH_PREFIX,
            PARTSMATCH_UPSTREAM,
            forward_workspace=True,
            forward_cookie=True,
        )

    def do_GET(self) -> None:
        if self.path == f"{PARTSMATCH_PREFIX}/_auth-check":
            self._partsmatch_auth_check()
            return
        if self.path.startswith(GCMATCH_PREFIX):
            self._proxy_to_gcmatch()
            return
        if self.path.startswith(PARTSMATCH_PREFIX):
            self._proxy_to_partsmatch()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path.startswith(GCMATCH_PREFIX):
            self._proxy_to_gcmatch()
            return
        if self.path.startswith(PARTSMATCH_PREFIX):
            self._proxy_to_partsmatch()
            return
        super().do_POST()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    os.chdir(ROOT)
    ensure_port_available("127.0.0.1", PORT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), OpmDevHandler)
    print(f"Serving {ROOT}")
    print(f"  Prod:  http://127.0.0.1:{PORT}/prod/index.html")
    print(f"  Dev:   http://127.0.0.1:{PORT}/dev/index.html")
    print(f"  Proxy: http://127.0.0.1:{PORT}{GCMATCH_PREFIX}/ → {GCMATCH_UPSTREAM}")
    print(
        f"  Proxy: http://127.0.0.1:{PORT}{PARTSMATCH_PREFIX}/ → {PARTSMATCH_UPSTREAM}"
    )
    auth_cookie, auth_source = load_partsmatch_auth_cookie()
    env_cookie = os.environ.get("PARTSMATCH_AUTH_COOKIE", "").strip()
    if auth_cookie:
        print(
            f"  Parts Match: cookie from {auth_source} ({len(auth_cookie)} chars)"
        )
        if auth_source == "file" and env_cookie:
            print(
                "  Note: $env:PARTSMATCH_AUTH_COOKIE is set but ignored "
                "(.env.partsmatch.local takes priority)"
            )
        ok, status = probe_partsmatch_auth(auth_cookie)
        if ok:
            print(f"  Parts Match: auth probe OK (HTTP {status})")
            print(f"  Auth check: http://127.0.0.1:{PORT}{PARTSMATCH_PREFIX}/_auth-check")
        else:
            print(
                f"  Parts Match: auth probe FAILED (HTTP {status}) — "
                "paste a fresh AppServiceAuthSession into .env.partsmatch.local"
            )
    else:
        print(
            "  Parts Match: add .env.partsmatch.local or set PARTSMATCH_AUTH_COOKIE"
        )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
