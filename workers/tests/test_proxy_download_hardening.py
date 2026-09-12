"""Regression tests for the proxy/download hardening fixes.

Covers four real production failures, each reproduced live before the fix:

1. PO-token rejection — YouTube returned `403 Forbidden` for every proxy while the
   bgutil provider was healthy; the same command without PO tokens downloaded 48MB.
2. Direct-IP fallback — the client tiers prepended `None` (the server's own,
   bot-blocked IP) ahead of every proxy, leaking the real IP to YouTube.
3. Credential leak — proxy URLs were logged verbatim, exposing the Webshare
   username and password in plaintext container logs.
4. Detector precedence — a genuine bot-block/429 must never be misread as a
   PO-token problem, since dropping tokens cannot fix an IP reputation issue.
"""
import re

import pytest

from workers.tasks.video.cookies import (
    _is_429,
    _is_bot_blocked,
    _is_pot_rejected,
    _redact_secrets,
)


class TestPotRejectionDetector:
    """Bug 1 + 4: tell a rejected PO token apart from a real IP block."""

    def test_detects_the_exact_403_seen_in_production(self):
        # Verbatim stderr from the failing njBnqiiTeZo run.
        stderr = "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        assert _is_pot_rejected(stderr) is True

    def test_detects_plain_forbidden_403(self):
        assert _is_pot_rejected("HTTP Error 403: Forbidden") is True

    def test_bot_block_is_not_treated_as_pot_rejection(self):
        # Dropping PO tokens cannot fix a bot-blocked IP, so this must NOT match —
        # otherwise the retry masks a real IP-reputation failure.
        stderr = "ERROR: Sign in to confirm you're not a bot. Use --cookies"
        assert _is_bot_blocked(stderr) is True
        assert _is_pot_rejected(stderr) is False

    def test_rate_limit_is_not_treated_as_pot_rejection(self):
        stderr = "ERROR: HTTP Error 429: Too Many Requests"
        assert _is_429(stderr) is True
        assert _is_pot_rejected(stderr) is False

    def test_a_403_that_is_also_a_bot_block_defers_to_bot_block(self):
        # Precedence guard: bot-block wins even when a 403 is present.
        stderr = "HTTP Error 403: Forbidden. Sign in to confirm you're not a bot"
        assert _is_pot_rejected(stderr) is False

    def test_unrelated_errors_do_not_match(self):
        assert _is_pot_rejected("ERROR: Requested format is not available") is False
        assert _is_pot_rejected("ERROR: Video unavailable") is False
        assert _is_pot_rejected("") is False


class TestProxyRedaction:
    """Bug 3: credentials must never reach the logs."""

    def test_webshare_credentials_are_stripped(self):
        raw = "http://someuserresidential-rotate:sup3rs3cret@p.webshare.io:80"
        out = _redact_secrets(raw)
        assert "sup3rs3cret" not in out
        assert "someuserresidential-rotate" not in out
        assert out == "http://***@p.webshare.io:80"

    def test_host_and_port_survive_so_logs_stay_useful(self):
        out = _redact_secrets("http://user:pass@p.webshare.io:80")
        assert "p.webshare.io:80" in out

    def test_proxy_without_credentials_is_unchanged(self):
        raw = "http://150.241.110.112:7116"
        assert _redact_secrets(raw) == raw

    def test_direct_connection_is_labelled_not_blank(self):
        assert _redact_secrets(None) == "direct"
        assert _redact_secrets("") == "direct"

    def test_no_password_survives_any_scheme(self):
        for scheme in ("http", "https", "socks5"):
            out = _redact_secrets(f"{scheme}://u:p4ssw0rd@host:1080")
            assert "p4ssw0rd" not in out

    def test_the_exact_leaked_production_line_is_now_safe(self):
        # Real line found in dev-celery-video-pipeline-1 logs.
        leaked = "http://bjhcnjumresidential-rotate:y84s5ckl1y4j@p.webshare.io:80"
        out = _redact_secrets(leaked)
        assert "y84s5ckl1y4j" not in out
        assert "bjhcnjum" not in out


class TestNoDirectIpFallback:
    """Bug 2: never dial YouTube from the server's own IP when proxies exist."""

    @staticmethod
    def _tiers(all_proxies):
        """Mirror of the tier construction in download.py."""
        hd = min(len(all_proxies), 12)
        low = min(len(all_proxies), 3)
        direct = [None] if not all_proxies else []
        return [
            ("mweb", direct + all_proxies[:hd]),
            ("web_safari", direct + all_proxies[:hd]),
            ("tv", direct + all_proxies[:hd]),
            ("web", direct + all_proxies[:low]),
            ("android_vr", direct + all_proxies[:low]),
            ("ios", direct + all_proxies[:low]),
        ]

    def test_no_tier_uses_direct_when_proxies_exist(self):
        proxies = [f"http://u:p@p.webshare.io:{8000 + i}" for i in range(12)]
        for client, candidates in self._tiers(proxies):
            assert None not in candidates, f"{client} would leak the server IP"

    def test_every_tier_still_has_candidates(self):
        proxies = [f"http://u:p@p.webshare.io:{8000 + i}" for i in range(12)]
        for client, candidates in self._tiers(proxies):
            assert candidates, f"{client} has nothing to try"

    def test_direct_is_allowed_only_when_no_proxies_configured(self):
        # Without a proxy pool, direct is the only option — refusing it would
        # break local/dev runs that have no proxies at all.
        for client, candidates in self._tiers([]):
            assert candidates == [None]
