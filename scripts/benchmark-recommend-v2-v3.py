#!/usr/bin/env python3
"""Compare recommend_from_ticket v2 vs v3 latency."""
from __future__ import annotations

import json
import statistics
import time
import urllib.error
import urllib.request

BASE = "https://con-gcmatch.blueplant-16804982.westus2.azurecontainerapps.io"
TICKET_TEXT = "Need replacement for 209120cpg2m24p1"
ENDPOINTS = [
    ("v1", "/recommend_from_ticket"),
    ("v2", "/recommend_from_ticket/v2"),
    ("v3", "/recommend_from_ticket/v3"),
]
RUNS = 3
TIMEOUT = 180
TOP_N = 3


def timed_post(path: str, ticket_text: str) -> tuple[float, int, object | None, str | None]:
    body = json.dumps({"ticket_text": ticket_text, "top_n": TOP_N}).encode()
    req = urllib.request.Request(
        BASE + path,
        data=body,
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
            return time.perf_counter() - t0, resp.status, data, None
    except urllib.error.HTTPError as err:
        try:
            detail = json.loads(err.read().decode())
        except Exception:
            detail = {"error": err.reason}
        return time.perf_counter() - t0, err.code, detail, None
    except Exception as exc:
        return time.perf_counter() - t0, 0, None, str(exc)


def recommend_count(data: object) -> int:
    if not isinstance(data, dict):
        return 0
    if data.get("message"):
        return 0
    recs = data.get("recommendations")
    return len(recs) if isinstance(recs, list) else 0


def main() -> int:
    print("Recommend API v1 / v2 / v3 benchmark")
    print(f"Base: {BASE}")
    print(f"Ticket: {TICKET_TEXT!r}")
    print(f"Runs per endpoint: {RUNS}\n")

    results: dict[str, dict] = {}

    for label, path in ENDPOINTS:
        print("=" * 60)
        print(f"{label} — POST {path}")
        print("=" * 60)
        times: list[float] = []

        for run in range(1, RUNS + 1):
            t, status, data, err = timed_post(path, TICKET_TEXT)
            times.append(t)
            recs = recommend_count(data) if not err else 0
            extra = ""
            if isinstance(data, dict):
                if data.get("message"):
                    extra = f", message={data['message']!r}"
                req_part = data.get("requested_part_number", "")
                if req_part:
                    extra += f", requested={req_part!r}"
            elif err:
                extra = f", error={err!r}"
            elif isinstance(data, dict) and data.get("detail"):
                extra = f", detail={data['detail']!r}"
            print(f"  run {run}: HTTP {status}, {t:.2f}s, recs={recs}{extra}")

        avg = statistics.mean(times)
        results[label] = {"path": path, "overall_avg_s": avg, "times_s": times}
        print(f"  avg: {avg:.2f}s  ({', '.join(f'{x:.2f}s' for x in times)})")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for label in ("v1", "v2", "v3"):
        r = results[label]
        print(f"{label}: {r['overall_avg_s']:.2f}s avg ({r['path']})")

    v2v3 = {k: v for k, v in results.items() if k in ("v2", "v3")}
    fastest = min(v2v3, key=lambda k: v2v3[k]["overall_avg_s"])
    slowest = max(v2v3, key=lambda k: v2v3[k]["overall_avg_s"])
    delta = v2v3[slowest]["overall_avg_s"] - v2v3[fastest]["overall_avg_s"]
    pct = (delta / v2v3[slowest]["overall_avg_s"]) * 100 if v2v3[slowest]["overall_avg_s"] else 0
    print(f"\nFASTEST (v2 vs v3): {fastest} ({v2v3[fastest]['overall_avg_s']:.2f}s)")
    print(f"                     {pct:.1f}% faster than {slowest}")

    print("\nJSON")
    print(json.dumps({"winner_v2_v3": fastest, "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
