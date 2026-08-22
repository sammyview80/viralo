"""Proxy provider abstraction for yt-dlp downloads.

Three providers, selected by PROXY_PROVIDER:

  - static       (default): parse a fixed comma-list from YTDLP_PROXY_LIST. Datacenter
                  IPs — cheap, but YouTube 360p-caps and bot-blocks them fast.
  - residential:  build N gateway URLs that differ only by session token. Residential
                  vendors (Bright Data / Oxylabs / IPRoyal) rotate the egress IP
                  server-side per distinct session, so each list entry resolves to a
                  fresh IP. Geo is pinned via the session username template.
  - webshare:     a single Webshare "Rotating Proxy Endpoint" (p.webshare.io:80) that
                  assigns a random IP from the pool on EVERY connection — no session
                  token needed. We return N copies of the one gateway URL so the
                  parallel-batch / client-major loops open N independent connections,
                  each landing on a different egress IP.

Both return list[str] — the exact shape the download loops already consume — so the
client-major / parallel-batch logic in video.py is untouched.

Cascade mode: set WEBSHARE_FIRST=true with PROXY_PROVIDER=static (default) plus
WEBSHARE_PROXY_USER/PASS present to prepend the webshare rotating pool ahead of the
static list. attempt % len(proxies) in the download retry loop then hits rotating
proxies on early attempts, falling through to static entries after. Opt-in via
WEBSHARE_FIRST rather than triggered by creds alone, matching this file's existing
pattern of explicit provider selection — avoids silently changing behavior for any
deployment that already has webshare creds set but wants static-only.
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
    if provider in ("webshare", "rotating"):
        return _webshare_rotating_proxies()

    static = _static_proxies()
    if provider == "static" and os.getenv("WEBSHARE_FIRST", "").lower() in ("1", "true", "yes"):
        user = os.getenv("WEBSHARE_PROXY_USER", "").strip()
        pw = os.getenv("WEBSHARE_PROXY_PASS", "").strip()
        if user and pw:
            rotating = _webshare_rotating_proxies()
            logging.info(
                "Proxy pool: %d webshare rotating entries + %d static (WEBSHARE_FIRST)",
                len(rotating), len(static))
            return rotating + static
    return static


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


def _webshare_rotating_proxies() -> list[str]:
    """Build N copies of a single Webshare rotating-endpoint URL.

    Webshare's rotating endpoint assigns a random IP per connection, so we don't
    vary the URL at all — N identical entries give the download loops N independent
    connections, each rotating to a fresh egress IP server-side.

    Env:
      WEBSHARE_PROXY_HOST       gateway host          (default p.webshare.io)
      WEBSHARE_PROXY_PORT       gateway port          (default 80)
      WEBSHARE_PROXY_USER       proxy username        (required; '-rotate' appended if absent)
      WEBSHARE_PROXY_PASS       proxy password        (required)
      WEBSHARE_PROXY_SCHEME     http | https | socks5 (default http)
      WEBSHARE_PROXY_POOL_SIZE  number of entries     (default 12)
    Falls back to static if credentials are missing.
    """
    user = os.getenv("WEBSHARE_PROXY_USER", "").strip()
    pw = os.getenv("WEBSHARE_PROXY_PASS", "").strip()
    if not (user and pw):
        logging.warning(
            "PROXY_PROVIDER=webshare but WEBSHARE_PROXY_USER/PASS incomplete "
            "— falling back to static proxies")
        return _static_proxies()

    host = os.getenv("WEBSHARE_PROXY_HOST", "p.webshare.io").strip()
    port = os.getenv("WEBSHARE_PROXY_PORT", "80").strip()
    scheme = os.getenv("WEBSHARE_PROXY_SCHEME", "http").strip()
    # The rotating endpoint requires the '-rotate' username suffix; add it if the
    # user supplied the bare account name.
    if not user.endswith("-rotate"):
        user = f"{user}-rotate"
    try:
        pool = max(1, int(os.getenv("WEBSHARE_PROXY_POOL_SIZE", "12")))
    except ValueError:
        pool = 12

    url = f"{scheme}://{quote(user, safe='')}:{quote(pw, safe='')}@{host}:{port}"
    proxies = [url] * pool
    logging.info("Proxy pool: %d connections via Webshare rotating endpoint %s:%s",
                 pool, host, port)
    return proxies
