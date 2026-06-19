#!/usr/bin/env python3
"""Fetch free SOCKS5 proxies from ProxyScrape, test speed, output working ones."""
import subprocess, sys, json
from concurrent.futures import ThreadPoolExecutor, as_completed

PROXYSCRAPE_API = (
    "https://api.proxyscrape.com/v3/free-proxy-list/get"
    "?request=displayproxies&protocol=socks5&timeout=5000"
    "&proxy_format=protocolipport&format=text"
)
TEST_URL = "https://www.youtube.com/robots.txt"
TIMEOUT = 8
MAX_WORKERS = 30
MIN_WORKING = 5


def fetch_proxies() -> list[str]:
    result = subprocess.run(
        ["curl", "-s", "--max-time", "10", PROXYSCRAPE_API],
        capture_output=True, text=True
    )
    proxies = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    print(f"Fetched {len(proxies)} proxies", file=sys.stderr)
    return proxies


def test_proxy(proxy: str) -> tuple[str, float] | None:
    try:
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{time_total}",
             "--proxy", proxy, "--max-time", str(TIMEOUT),
             "--connect-timeout", "4", TEST_URL],
            capture_output=True, text=True, timeout=TIMEOUT + 2
        )
        if result.returncode == 0:
            t = float(result.stdout.strip())
            if t > 0:
                return proxy, t
    except Exception:
        pass
    return None


def main():
    proxies = fetch_proxies()
    if not proxies:
        print("ERROR: no proxies fetched", file=sys.stderr)
        sys.exit(1)

    print(f"Testing {len(proxies)} proxies (timeout={TIMEOUT}s)...", file=sys.stderr)
    working = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(test_proxy, p): p for p in proxies}
        for f in as_completed(futures):
            res = f.result()
            if res:
                working.append(res)
                print(f"  OK {res[0]} ({res[1]:.2f}s)", file=sys.stderr)
                if len(working) >= MIN_WORKING * 3:
                    break

    working.sort(key=lambda x: x[1])
    best = [p for p, _ in working[:10]]

    if not best:
        print("ERROR: no working proxies found", file=sys.stderr)
        sys.exit(1)

    print(f"\nFound {len(best)} working proxies:", file=sys.stderr)
    proxy_list = ",".join(best)
    print(f"\nYTDLP_PROXY_LIST={proxy_list}")
    print(f"\nAdd to .env on prod server ↑", file=sys.stderr)


if __name__ == "__main__":
    main()
