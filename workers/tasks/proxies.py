"""Proxy provider abstraction for yt-dlp downloads.

Four providers, selected by PROXY_PROVIDER:

  - free         (default): read a pool of already-VALIDATED free proxies from redis
                  (see workers/tasks/video/proxy_refresh.py, which fetches + real-tests
                  a public free-proxy list on a schedule and persists survivors with a
                  short TTL). No cost, no signup — the tradeoff is a smaller, rotating
                  pool of lower-quality IPs than a paid plan. Falls back to static if
                  the redis pool is empty/stale.
  - static:       parse a fixed comma-list from YTDLP_PROXY_LIST. Datacenter
                  IPs — cheap, but YouTube 360p-caps and bot-blocks them fast.
  - residential:  build N gateway URLs that differ only by session token. Residential
                  vendors (Bright Data / Oxylabs / IPRoyal) rotate the egress IP
                  server-side per distinct session, so each list entry resolves to a
                  fresh IP. Geo is pinned via the session username template.
  - webshare:     a single Webshare "Rotating Proxy Endpoint" (p.webshare.io:80) that
                  assigns a random IP from the pool on EVERY connection — no session
                  token needed. We return N copies of the one gateway URL so the
                  parallel-batch / client-major loops open N independent connections,
                  each landing on a different egress IP. PAID — kept fully intact and
                  available, just no longer the default. Re-enable anytime with
                  PROXY_PROVIDER=webshare (+ WEBSHARE_PROXY_USER/PASS), zero code changes.

All return list[str] — the exact shape the download loops already consume — so the
client-major / parallel-batch logic in video.py is untouched.

Cascade mode: set WEBSHARE_FIRST=true with PROXY_PROVIDER=static plus
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

# Written by workers/tasks/video/proxy_refresh.py:refresh_free_proxy_pool, read here.
# Single source of truth for the key name so writer and reader can't drift apart.
FREE_PROXY_POOL_REDIS_KEY = "ytdlp:free_proxy_pool"

_REDIS_CLIENT = None


def _redis_client():
    """Standalone redis connection, independent of workers.tasks.video's heavy
    import chain (numpy/cv2/PyAV) — proxies.py stays importable/cheap on its own,
    including from the light beat/schedule process.
    """
    global _REDIS_CLIENT
    if _REDIS_CLIENT is None:
        import redis as _redis
        redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        _REDIS_CLIENT = _redis.from_url(
            redis_url, max_connections=5, socket_connect_timeout=5, socket_timeout=5)
    return _REDIS_CLIENT


def _redact(value) -> str:
    """Best-effort credential redaction for log lines in this module.

    Free/static proxy URLs carry no credentials today, but residential/webshare
    ones do — lazy-import the shared `_redact_secrets` (defined in
    workers.tasks.video.cookies) so every provider's log lines are scrubbed the
    same way, without giving this module a module-level dependency on the heavy
    video package (only pulled in the first time a log line actually needs it).
    """
    try:
        from workers.tasks.video.cookies import _redact_secrets
        return _redact_secrets(value)
    except Exception:
        return "***" if value else "direct"


def get_proxies() -> list[str]:
    """Backward-compatible list[str] view. Prefer get_proxies_with_trust() for
    any call site that will attach cookies — see its docstring for why.
    """
    proxies, _trusted = get_proxies_with_trust()
    return proxies


def get_proxies_with_trust() -> tuple[list[str], bool]:
    """Return (proxies, trusted) as ONE atomic decision.

    SECURITY (default-deny by construction, not by registry): `trusted` is
    computed in the same call, from the same read, that produces `proxies` —
    there is no separate "is this proxy trusted" lookup a caller could run
    against stale state, and no mutable set that has to be kept in sync as new
    call sites appear. Every current and future caller that wants to decide
    whether to attach YouTube cookies MUST use the `trusted` value returned
    HERE, not re-derive it from the proxy string or from PROXY_PROVIDER alone.

    Within a single call, every proxy shares the same trust value: this
    function only ever returns proxies from exactly one source (or, for the
    WEBSHARE_FIRST cascade, two — both already-trusted). Only the 'free'
    provider can produce untrusted proxies, and only when it actually reads
    live entries from the public redis pool (its own static fallback is
    trusted, same as calling _static_proxies() directly).
    """
    # Default is free (self-refreshing validated pool, no cost) — explicit opt-in
    # required for static/residential/webshare. Webshare remains fully supported;
    # set PROXY_PROVIDER=webshare (+ creds) to switch back with zero code changes.
    provider = os.getenv("PROXY_PROVIDER", "free").lower()
    if provider == "free":
        return _free_proxies_with_trust()
    if provider == "residential":
        return _residential_proxies(), True
    if provider in ("webshare", "rotating"):
        return _webshare_rotating_proxies(), True

    static = _static_proxies()
    if provider == "static" and os.getenv("WEBSHARE_FIRST", "").lower() in ("1", "true", "yes"):
        user = os.getenv("WEBSHARE_PROXY_USER", "").strip()
        pw = os.getenv("WEBSHARE_PROXY_PASS", "").strip()
        if user and pw:
            rotating = _webshare_rotating_proxies()
            logging.info(
                "Proxy pool: %d webshare rotating entries + %d static (WEBSHARE_FIRST)",
                len(rotating), len(static))
            return rotating + static, True
    return static, True


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


def _free_proxies() -> list[str]:
    """Backward-compatible list[str] view of _free_proxies_with_trust()."""
    proxies, _trusted = _free_proxies_with_trust()
    return proxies


def _free_proxies_with_trust() -> tuple[list[str], bool]:
    """Read the pool of pre-validated free proxies from redis; (proxies, trusted).

    Populated by workers.tasks.video.proxy_refresh.refresh_free_proxy_pool, which
    only writes proxies that passed a REAL yt-dlp video-info extraction (the same
    test_proxy()/score_result() logic in proxy_quality_tester.py) — never raw,
    untested candidates straight off the public list. Even so, these are public,
    unauthenticated, third-party-operated proxies — `trusted` is always False
    when this branch actually returns live entries from that pool, so callers
    know never to attach YouTube cookies to a request routed through one
    (yt-dlp needs --no-check-certificate for proxies in general, so a malicious
    one could otherwise terminate TLS and read the cookie in plaintext).

    Falls back to _static_proxies() (same fallback pattern used by the
    residential/webshare providers above, and trusted the same way — operator-
    configured via YTDLP_PROXY_LIST) when the redis pool is empty — which
    covers both "refresh task hasn't run yet" and "pool TTL expired" (free
    proxies die fast; TTL expiry IS the staleness signal here, so an empty read
    is treated as failure rather than a distinct check).
    """
    try:
        raw = _redis_client().lrange(FREE_PROXY_POOL_REDIS_KEY, 0, -1)
    except Exception as exc:
        logging.warning("Could not read free proxy pool from redis: %s", _redact(exc))
        raw = []

    proxies = [p.decode() if isinstance(p, bytes) else p for p in (raw or [])]
    if proxies:
        logging.info("Proxy pool: %d validated free proxies from redis", len(proxies))
        return proxies, False

    logging.warning(
        "PROXY_PROVIDER=free but redis pool %r is empty/stale (refresh_free_proxy_pool "
        "hasn't run yet, or nothing passed real yt-dlp validation) — falling back to "
        "static proxies", FREE_PROXY_POOL_REDIS_KEY)
    return _static_proxies(), True


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


def get_static_fallback_proxy() -> str | None:
    """Return a single STATIC (non-rotating) Webshare proxy URL, or None if unset.

    Real production failure: when the rotating-endpoint account runs out of
    balance, EVERY rotating connection gets a 402 Payment Required, and the
    download loop falls straight through to direct/no-proxy — which YouTube
    bot-blocks on this host's flagged IP. A separate static Webshare plan
    (different balance/billing) gives one more proxy tier to try before
    giving up on a proxied connection entirely.

    Configure with either:
      WEBSHARE_STATIC_PROXY_URL             full "scheme://user:pass@host:port" URL, or
      WEBSHARE_STATIC_PROXY_HOST/PORT/USER/PASS/SCHEME (mirrors the rotating-endpoint
                                             vars above; SCHEME defaults to http)

    Silently returns None (no fallback tier, no behavior change) when neither
    form is configured — this is an opt-in ops safety net, not a required var.
    """
    full_url = os.getenv("WEBSHARE_STATIC_PROXY_URL", "").strip()
    if full_url:
        return full_url

    host = os.getenv("WEBSHARE_STATIC_PROXY_HOST", "").strip()
    port = os.getenv("WEBSHARE_STATIC_PROXY_PORT", "").strip()
    user = os.getenv("WEBSHARE_STATIC_PROXY_USER", "").strip()
    pw = os.getenv("WEBSHARE_STATIC_PROXY_PASS", "").strip()
    if not (host and port and user and pw):
        return None

    scheme = os.getenv("WEBSHARE_STATIC_PROXY_SCHEME", "http").strip()
    return f"{scheme}://{quote(user, safe='')}:{quote(pw, safe='')}@{host}:{port}"
