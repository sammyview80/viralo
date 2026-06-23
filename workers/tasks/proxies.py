"""Proxy provider abstraction for yt-dlp downloads.

Two providers, selected by PROXY_PROVIDER:

  - static       (default): parse a fixed comma-list from YTDLP_PROXY_LIST. Datacenter
                  IPs — cheap, but YouTube 360p-caps and bot-blocks them fast.
  - residential:  build N gateway URLs that differ only by session token. Residential
                  vendors (Bright Data / Oxylabs / IPRoyal) rotate the egress IP
                  server-side per distinct session, so each list entry resolves to a
                  fresh IP. Geo is pinned via the session username template.

Both return list[str] — the exact shape the download loops already consume — so the
client-major / parallel-batch logic in video.py is untouched.
"""
import logging
import os
import re
import secrets
from urllib.parse import quote

# scheme://[auth@]host:port  — salvages a valid proxy even when .env pollution is
# glued on with no delimiter (missing newline concatenates the next var).
_STATIC_RE = re.compile(r'(socks[45]?|https?)://(?:[^@/\s]+@)?[\w.\-]+:\d{2,5}')


def get_proxies() -> list[str]:
    provider = os.getenv("PROXY_PROVIDER", "static").lower()
    if provider == "residential":
        return _residential_proxies()
    return _static_proxies()


def _static_proxies() -> list[str]:
    """Parse YTDLP_PROXY_LIST env var. No fetching, no TCP tests."""
    proxies: list[str] = []
    for part in os.getenv("YTDLP_PROXY_LIST", "").split(","):
        # Strip embedded CR/whitespace: a CRLF .env glues "\r" *inside* an entry
        # (http://user:pass\r@host:port), which \s below treats as a break and drops it.
        raw = "".join(part.split())
        if not raw:
            continue
        if not raw.startswith(("socks", "http")):
            raw = f"socks5://{raw}"
        m = _STATIC_RE.match(raw)
        if not m:
            logging.warning("Skipping malformed proxy entry: %r", raw[:80])
            continue
        p = m.group(0)
        if p != raw:
            logging.warning("Salvaged proxy %r from polluted entry %r (fix .env newline)", p, raw[:80])
        proxies.append(p)
    if proxies:
        logging.info("Proxy pool: %d static proxies from YTDLP_PROXY_LIST", len(proxies))
    else:
        logging.warning("YTDLP_PROXY_LIST not set or empty — no static proxies available")
    return proxies


def _residential_proxies() -> list[str]:
    """Build a pool of gateway URLs differing only by session token (= fresh IP each).

    Env:
      RESIDENTIAL_PROXY_GATEWAY        host:port of the rotating gateway (required)
      RESIDENTIAL_PROXY_USER           account/zone username (required)
      RESIDENTIAL_PROXY_PASS           account password (required)
      RESIDENTIAL_PROXY_SCHEME         http | https | socks5   (default http)
      RESIDENTIAL_PROXY_COUNTRY        ISO country to pin, e.g. us   (default us)
      RESIDENTIAL_PROXY_POOL_SIZE      number of distinct sessions   (default 12)
      RESIDENTIAL_PROXY_USER_TEMPLATE  username format with {user}/{country}/{session}
                                       placeholders (default Bright-Data style)
    Falls back to static if credentials are missing.
    """
    gateway = os.getenv("RESIDENTIAL_PROXY_GATEWAY", "").strip()
    user = os.getenv("RESIDENTIAL_PROXY_USER", "").strip()
    pw = os.getenv("RESIDENTIAL_PROXY_PASS", "").strip()
    if not (gateway and user and pw):
        logging.warning(
            "PROXY_PROVIDER=residential but RESIDENTIAL_PROXY_GATEWAY/USER/PASS incomplete "
            "— falling back to static proxies")
        return _static_proxies()

    scheme = os.getenv("RESIDENTIAL_PROXY_SCHEME", "http").strip()
    country = os.getenv("RESIDENTIAL_PROXY_COUNTRY", "us").strip()
    template = os.getenv("RESIDENTIAL_PROXY_USER_TEMPLATE",
                         "{user}-country-{country}-session-{session}")
    try:
        pool = max(1, int(os.getenv("RESIDENTIAL_PROXY_POOL_SIZE", "12")))
    except ValueError:
        pool = 12

    proxies: list[str] = []
    for _ in range(pool):
        session = secrets.token_hex(4)
        username = template.format(user=user, country=country, session=session)
        proxies.append(f"{scheme}://{quote(username, safe='')}:{quote(pw, safe='')}@{gateway}")
    logging.info("Proxy pool: %d residential sessions via gateway %s (country=%s)",
                 pool, gateway, country or "any")
    return proxies
