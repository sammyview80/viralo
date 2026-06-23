"""
Video processing pipeline — ClipForge-based.
PyAV for video I/O (no ffmpeg needed for clip export/audio).
Groq Whisper (word timestamps) + Groq LLaMA for AI scoring.
Pillow for caption burn-in.
ffmpeg still used for YouTube download + metadata probe fallback.
"""
import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field, replace as dataclass_replace
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Optional

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app


from workers.tasks.video._core import *
from workers.tasks.video.cookies import *
from workers.tasks.video.transcribe import *
from workers.tasks.video.ai import *
from workers.tasks.video.render import *

__all__ = [
    '_ytdlp_fetch_json_worker',
    '_fetch_youtube_metadata',
    '_get_youtube_info',
    '_get_youtube_duration',
    '_QUALITY_LADDER',
    '_list_youtube_formats',
    '_download_youtube',
    '_fetch_youtube_captions',
    '_parse_vtt_to_words',
]

def _ytdlp_fetch_json_worker(url: str, timeout: int = 20) -> dict:
    """Lightweight yt-dlp --dump-json call for chapter/metadata extraction. Non-fatal."""
    base = _ytdlp_base_flags(proxy=None)
    cmd = ["yt-dlp", "--no-download", "--dump-json", "--no-playlist"] + base + [
        "--extractor-args", "youtube:player_client=tv_embedded", url
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip().splitlines()[0])
    except Exception as e:
        logging.warning("_ytdlp_fetch_json_worker failed: %s", e)
    return {}


def _fetch_youtube_metadata(url: str, video_id: str | None = None) -> dict:
    """Return {title, thumbnail_url} for a YouTube URL.

    Uses YouTube oEmbed API (no auth, no rate-limit) for title + thumbnail,
    then uploads thumbnail to Cloudinary so we own the URL.
    """
    import urllib.request as _urllib_req
    import urllib.parse as _urllib_parse
    try:
        # oEmbed: lightweight, no bot-detection, returns title + thumbnail_url
        oembed_url = f"https://www.youtube.com/oembed?url={_urllib_parse.quote(url, safe='')}&format=json"
        with _urllib_req.urlopen(oembed_url, timeout=10) as resp:
            info = json.loads(resp.read())

        title = (info.get("title") or "")[:255]
        raw_thumb = info.get("thumbnail_url") or ""

        # oEmbed gives sddefault; swap to maxresdefault for better quality
        if raw_thumb and "/hqdefault" in raw_thumb:
            raw_thumb = raw_thumb.replace("/hqdefault", "/sddefault")

        thumbnail_url = raw_thumb  # fallback: store YT URL as-is

        if raw_thumb and video_id:
            try:
                thumb_data = _urllib_req.urlopen(raw_thumb, timeout=15).read()
                storage_key = f"thumbnails/{video_id}/thumb.jpg"
                provider = os.getenv("STORAGE_PROVIDER", "local")
                if provider == "cloudinary":
                    import cloudinary as _cld, cloudinary.uploader as _cld_up, os as _os2
                    _cld.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))
                    pub_id = _os2.path.splitext(storage_key)[0]
                    result = _cld_up.upload(thumb_data, public_id=pub_id, resource_type="image", overwrite=True)
                    thumbnail_url = result["secure_url"]
                else:
                    from shared.storage.base import get_storage
                    storage = get_storage(provider)
                    thumbnail_url = asyncio.run(storage.upload(thumb_data, storage_key, "image/jpeg"))
            except Exception as e:
                logging.warning("thumbnail upload failed, using raw URL: %s", e)

        return {"title": title, "thumbnail_url": thumbnail_url}
    except Exception as e:
        logging.warning("_fetch_youtube_metadata failed: %s", e)
        return {"title": "", "thumbnail_url": ""}


def _get_youtube_info(url: str) -> dict:
    """Return {duration, is_live, live_status} via yt-dlp --dump-json (no download).
    Returns empty dict on failure so callers can decide whether to block or proceed."""
    try:
        # Strip playlist params — yt-dlp hangs enumerating playlists
        from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
        parsed = urlparse(url)
        qs = {k: v for k, v in parse_qs(parsed.query).items() if k not in ("list", "index", "start_radio")}
        url = urlunparse(parsed._replace(query=urlencode({k: v[0] for k, v in qs.items()})))
        base = _ytdlp_base_flags(None)
        result = subprocess.run(
            ["yt-dlp"] + base + ["--dump-json", "--no-download", "--no-playlist", url],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            info = json.loads(result.stdout.splitlines()[0])
            return {
                "duration": float(info.get("duration") or 0) or None,
                "is_live": bool(info.get("is_live")),
                "live_status": info.get("live_status") or "",
            }
    except Exception as e:
        logging.warning("_get_youtube_info failed: %s", e)
    return {}


def _get_youtube_duration(url: str) -> float | None:
    return _get_youtube_info(url).get("duration")


# Canonical quality ladder shown in the UI. "source" (best available) is always
# offered when the video has any downloadable format.
_QUALITY_LADDER = [("1080p", 1080), ("720p", 720), ("480p", 480), ("360p", 360)]


def _list_youtube_formats(url: str, timeout: int = 30, max_proxy_tries: int = 5) -> dict:
    """Probe the qualities actually available for a YouTube URL (no download).

    Returns {"qualities": ["source", "1080p", ...], "max_height": int,
             "title": str|None, "duration": float|None,
             "formats": [{"height", "fps", "ext", "filesize"}]}.
    Raises RuntimeError when the video is private/unavailable or yields no formats.

    Reuses the same `tv` client + bgutil PO token + cookies + proxy fallback proven
    for downloads, so the qualities reported match what a download can actually fetch.
    """
    from urllib.parse import urlparse, urlencode, parse_qs, urlunparse
    p = urlparse(url)
    qs = {k: v[0] for k, v in parse_qs(p.query).items()
          if k not in ("list", "index", "start_radio")}
    url = urlunparse(p._replace(query=urlencode(qs)))

    # Track whether any attempt explicitly reported a private/members-only video —
    # only that is a hard, client-actionable failure. A bot-block / "unavailable" on
    # the direct (no-proxy) attempt is NOT fatal: the proxy attempts may still succeed.
    saw_private = False

    def _probe(proxy: str | None, client: str) -> dict | None:
        nonlocal saw_private
        base = _ytdlp_base_flags(proxy, use_cookies=True)
        cmd = (["yt-dlp"] + base + _pot_args(client)
               + ["--extractor-args", f"youtube:player_client={client}",
                  "-J", "--no-download", "--no-playlist", url])
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return None
        stderr = (r.stderr or "").lower()
        if "private video" in stderr or "members-only" in stderr or "members only" in stderr:
            saw_private = True
            return None
        if r.returncode != 0 or not r.stdout.strip():
            return None
        try:
            info = json.loads(r.stdout.splitlines()[0])
        except (json.JSONDecodeError, IndexError):
            return None
        # Require at least one real video format — a metadata-only / images-only
        # extraction (n-challenge failed, no PO token) has no usable formats.
        if not any(f.get("height") and f.get("vcodec") not in (None, "none")
                   for f in (info.get("formats") or [])):
            return None
        return info

    # Mirror the download's client-major fallback. CRUCIAL: the `tv` client is the only
    # one that returns the full HD/4K ladder through datacenter proxies — `web` is
    # capped at a single 360p stream on those IPs. So give `tv` an EXHAUSTIVE proxy
    # search (direct + many proxies); only after tv fails everywhere do we accept a
    # lower client. Otherwise tv failing on the first few proxies would settle for
    # web@360p even though a later proxy would have yielded 1080p+ — matching what the
    # real download (which walks every proxy for tv) actually fetches.
    all_proxies = _ytdlp_proxies()
    hd_tries = min(len(all_proxies), max(max_proxy_tries, 12))
    low_tries = min(len(all_proxies), 3)
    # HD-capable clients first (tv / mweb / web_safari) with an exhaustive proxy search:
    # `tv` is DRM-experiment-blocked on many proxy IPs (images-only), so mweb/web_safari
    # must also get a wide search before we accept the 360p-capped `web`. See the
    # download tier comment and yt-dlp #12563.
    tiers = [
        ("mweb", [None] + all_proxies[:hd_tries]),
        ("web_safari", [None] + all_proxies[:hd_tries]),
        ("tv", [None] + all_proxies[:hd_tries]),
        ("web", [None] + all_proxies[:low_tries]),
        ("android_vr", [None] + all_proxies[:low_tries]),
        ("ios", [None] + all_proxies[:low_tries]),
    ]
    info = None
    for client, candidates in tiers:
        for proxy in candidates:
            info = _probe(proxy, client)
            if info:
                break
        if info:
            break
    if not info or not info.get("formats"):
        if saw_private:
            raise RuntimeError("Video is private, members-only, or unavailable")
        raise RuntimeError("No downloadable formats found for this video")

    # Best (largest) entry per video height.
    by_h: dict[int, dict] = {}
    for f in info["formats"]:
        h = f.get("height")
        if not h or f.get("vcodec") in (None, "none"):
            continue
        size = f.get("filesize") or f.get("filesize_approx")
        cur = by_h.get(h)
        if cur is None or (size and (cur.get("filesize") or 0) < size):
            by_h[h] = {"height": int(h), "fps": f.get("fps"),
                       "ext": f.get("ext"), "filesize": size}
    if not by_h:
        raise RuntimeError("No video formats found for this video")

    max_h = max(by_h)
    qualities = ["source"] + [label for label, h in _QUALITY_LADDER if max_h >= h]
    formats = [by_h[h] for h in sorted(by_h, reverse=True)]
    return {
        "qualities": qualities,
        "max_height": max_h,
        "title": info.get("title"),
        "duration": float(info.get("duration") or 0) or None,
        "formats": formats,
    }


def _download_youtube(url: str, out_path: str, quality: str = "source", progress_cb=None, tenant_id: str | None = None) -> str | None:
    """Download a video, preferring the high-quality `tv` client.

    Returns the name of the yt-dlp client that actually succeeded ("tv", "web",
    "android_vr", "pytubefix", …) so the caller can warn the user when the
    high-quality `tv` path was unavailable and a lower-quality client was used.
    Raises RuntimeError if every strategy fails.
    """
    import time, random
    errors = []
    winner: dict[str, str | None] = {"client": None}
    proxies = _ytdlp_proxies_with_refresh()

    def _client_of(cmd: list[str]) -> str:
        """Extract the yt-dlp player_client from a built command, for win reporting."""
        for c in cmd:
            if c.startswith("youtube:player_client="):
                return c.split("=", 1)[1]
        return "default"

    def _pick_proxy(attempt: int) -> str | None:
        if not proxies:
            return None
        return proxies[attempt % len(proxies)]

    if quality == "source":
        # bestvideo+bestaudio (any codec — VP9/AV1 carry 4K on YouTube), remux to mp4
        fmt = "bestvideo+bestaudio/best"
        fmt_fallback = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    else:
        cap = {"1080p": 1080, "720p": 720, "480p": 480, "360p": 360}.get(quality, 1080)
        fmt = f"bestvideo[height<={cap}]+bestaudio/best[height<={cap}]"
        fmt_fallback = f"bestvideo[height<={cap}][ext=mp4]+bestaudio[ext=m4a]/best[height<={cap}][ext=mp4]/best"

    def _client_args(proxy: str | None) -> list[list[str]]:
        """Return ordered strategy list — best quality first, fallbacks after.

        Order reflects tested 2026 success rates: tv_embedded (+PO+cookies) and
        android_vr download full streams; the `default` client auto-picks a
        working one; web/ios are broken (SABR / n-challenge / no formats) so go
        last. Cookies on every strategy (android ignores them harmlessly).
        """
        bc = _ytdlp_base_flags(proxy, use_cookies=True)  # cookies on every strategy
        base = _ytdlp_base_flags(proxy)
        return [
            # mweb + PO + cookies: full HD/4K ladder. PRIMARY client — it is NOT under the
            # tv DRM experiment that leaves tv images-only on most datacenter/proxy IPs
            # (yt-dlp #12563), so it wins where tv wastes a full proxy sweep failing.
            ["yt-dlp"] + bc + _pot_args("mweb") + ["--extractor-args", "youtube:player_client=mweb",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # web_safari + PO + cookies: full ladder too (not 360p-capped like plain web).
            ["yt-dlp"] + bc + _pot_args("web_safari") + ["--extractor-args", "youtube:player_client=web_safari",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # tv + PO + cookies: full 480-1440p+ ladder WHEN the IP isn't under the DRM
            # experiment (e.g. clean residential IPs). Tried after mweb/web_safari since it
            # is dead on flagged datacenter IPs.
            ["yt-dlp"] + bc + _pot_args("tv") + ["--extractor-args", "youtube:player_client=tv",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # android_vr: PO-free, works on clean IPs
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=android_vr",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # default client + PO + cookies: yt-dlp auto-negotiates a working client
            ["yt-dlp"] + bc + _pot_args("web") + ["-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # android: different quota bucket
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=android",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # tv mp4-only format fallback
            ["yt-dlp"] + bc + _pot_args("tv") + ["--extractor-args", "youtube:player_client=tv",
                                  "-f", fmt_fallback, "--merge-output-format", "mp4", "-o", out_path, url],
            # ios: usually no formats now, but different quota bucket — try late
            ["yt-dlp"] + base + ["--extractor-args", "youtube:player_client=ios",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # web + PO + cookies: SABR-limited, last real attempt
            ["yt-dlp"] + bc + _pot_args("web") + ["--extractor-args", "youtube:player_client=web",
                                  "-f", fmt, "--merge-output-format", "mp4", "-o", out_path, url],
            # Last resort: most permissive selector via default client, ignores quality cap
            ["yt-dlp"] + bc + _pot_args("web") + ["-f", "bv*+ba/b/best/bv*/b*", "--merge-output-format", "mp4", "-o", out_path, url],
        ]

    import threading

    def _run_strategy(cmd: list[str], label: str, attempt: int) -> tuple[bool, str]:
        """Run one yt-dlp command. Returns (success, stderr)."""
        state = {"last_pct": 0}
        try:
            proc = subprocess.Popen(
                cmd + ["--newline"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True,
            )
            stderr_lines: list[str] = []

            def _drain_stdout():
                for _ in proc.stdout:
                    pass

            def _drain_stderr():
                for line in proc.stderr:
                    line = line.rstrip()
                    stderr_lines.append(line)
                    if progress_cb and "[download]" in line:
                        import re as _re
                        m = _re.search(r'(\d+\.?\d*)%', line)
                        if m:
                            pct = min(int(float(m.group(1))), 99)
                            if pct > state["last_pct"]:
                                state["last_pct"] = pct
                                progress_cb(pct)

            t_out = threading.Thread(target=_drain_stdout, daemon=True)
            t_err = threading.Thread(target=_drain_stderr, daemon=True)
            t_out.start(); t_err.start()
            t_out.join(timeout=310); t_err.join(timeout=310)
            proc.wait(timeout=300)
            if proc.returncode == 0 and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
                return True, ""
            return False, "\n".join(stderr_lines[-20:])
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except Exception:
                pass
            return False, "timeout"
        except Exception as e:
            return False, str(e)

    # Phase 0: high-quality DIRECT attempt (no proxy) FIRST. Our own egress IP is
    # usually unflagged, so the `tv` client (full HD/4K ladder, +PO +cookies) succeeds
    # fast and clean here. Only when direct is bot-walled/429'd do we fall to proxies.
    # Without this, Phase 1 races `web`@360p across every proxy and a proxied 360p win
    # returns BEFORE the direct `tv` 4K path is ever tried — capping every download at
    # 360p whenever `tv` has a transient miss on the proxy pool.
    # On a known-flagged host (datacenter egress IP) direct attempts always bot-wall,
    # so Phase 0 just burns ~3s before the proxy phase. Set YTDLP_SKIP_DIRECT=1 there.
    direct_hq = [] if os.getenv("YTDLP_SKIP_DIRECT") == "1" else _client_args(None)[:3]
    for attempt, cmd in enumerate(direct_hq):
        label = _client_of(cmd)
        logging.info("Phase 0: direct high-quality client=%s", label)
        ok, stderr = _run_strategy(cmd, label, attempt)
        if ok:
            winner["client"] = label
            logging.info("Phase 0 won: direct client=%s", label)
            return winner["client"]
        errors.append(f"phase0 {label}: {stderr[:200]}")
        if _is_bad_cookies(stderr):
            logging.error("YouTube cookies INVALID/EXPIRED — refresh yt-cookies.txt")
            break
        if _is_429(stderr) or _is_bot_blocked(stderr):
            logging.warning("Direct high-quality %s hit bot/429 — falling to proxies", label)
            break

    # Phase 1: try env proxies SEQUENTIALLY — one proxy at a time, fall through to the
    # next only after the current one fails all its clients. Racing all proxies in
    # parallel hammered the same video from N IPs at once, which itself trips bot
    # detection; sequential is gentler and stops as soon as one proxy wins.
    # Set YTDLP_PROXY_PARALLEL=1 to restore the old parallel race.
    if proxies:
        import concurrent.futures, threading as _threading
        _parallel = os.getenv("YTDLP_PROXY_PARALLEL", "") == "1"
        logging.info("Phase 1: trying %d env proxies (%s)", len(proxies),
                     "parallel race" if _parallel else "sequential")
        proxy_errors: list[str] = []
        proxy_errors_lock = _threading.Lock()
        move_lock = _threading.Lock()
        moved = _threading.Event()

        def _try_proxy(proxy: str, idx: int, clients: list[str]) -> bool:
            if moved.is_set():
                return False
            import threading as _t

            for client in clients:
                if moved.is_set():
                    return False
                tmp_path = out_path + f".proxy{idx}.tmp"
                base = _ytdlp_base_flags(proxy, use_cookies=True)
                cmd = (["yt-dlp"] + base + _pot_args(client) +
                       ["--extractor-args", f"youtube:player_client={client}",
                        "-f", fmt, "--merge-output-format", "mp4", "-o", tmp_path, url])
                try:
                    proc = subprocess.Popen(cmd + ["--newline"],
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                    stderr_lines: list[str] = []

                    def _drain(p=proc, sl=stderr_lines):
                        for line in p.stderr:
                            sl.append(line.rstrip())
                            if moved.is_set():
                                p.kill()
                                return

                    t_stdout = _t.Thread(target=lambda p=proc: [_ for _ in p.stdout], daemon=True)
                    t_stderr = _t.Thread(target=_drain, daemon=True)
                    t_stdout.start(); t_stderr.start()
                    # tv_embedded fetches a PO token + handshakes through the proxy
                    # before download starts — 30s was too tight and killed live-but-slow
                    # proxies mid-handshake. 60s gives them room; dead proxies still cut fast.
                    proc.wait(timeout=60)
                    t_stderr.join(timeout=3)
                    produced = _resolve_downloaded(tmp_path) if proc.returncode == 0 else None
                    if produced:
                        with move_lock:
                            if not moved.is_set():
                                import shutil as _sh
                                _sh.move(produced, out_path)
                                moved.set()
                                winner["client"] = client
                                logging.info("Proxy race won by %s client=%s", proxy, client)
                                return True
                    # Find the actual ERROR line. Skip [debug]/[download]/[info] progress
                    # lines — with metadata-only clients (android_vr) the last stderr
                    # line is a harmless [debug] line that reads as a fake ERROR.
                    error_lines = [
                        l for l in stderr_lines
                        if l.strip() and not l.startswith("  ")
                        and not l.lstrip().startswith(("[debug]", "[download]", "[info]", "[youtube]"))
                    ]
                    if not error_lines:
                        # rc=0 + no file = client extracted metadata only (no usable formats / no PO token)
                        error_lines = [
                            "no downloadable formats (metadata-only extraction — missing PO token?)"
                            if proc.returncode == 0 else (stderr_lines[-1] if stderr_lines else "")
                        ]
                    actual_error = error_lines[-1]
                    stderr = "\n".join(stderr_lines[-5:])
                    reason = "429" if _is_429(stderr) else ("bot" if _is_bot_blocked(stderr) else "failed")
                    is_fmt_unavailable = "not available" in actual_error and "format" in actual_error.lower()
                    logging.warning("Proxy[%d] %s client=%s → %s | rc=%s | ERROR: %s", idx, proxy, client, reason, proc.returncode, actual_error[:300])
                    with proxy_errors_lock:
                        proxy_errors.append(f"proxy[{idx}] {proxy} [{client}]: {reason}: {actual_error[:150]}")
                    if _is_429(stderr) or _is_bot_blocked(stderr):
                        break  # same proxy, different clients won't help if IP is blocked
                    if is_fmt_unavailable:
                        # Requested selector matched nothing — retry the SAME client with the
                        # most permissive selector, ignoring any quality cap. Fixes the case
                        # where the only streams are above the requested cap, or only a
                        # progressive `best` exists. If THIS still finds nothing, the video
                        # genuinely has no a/v formats for this client (e.g. dead cookies → SABR).
                        tmp_path2 = out_path + f".proxy{idx}.best.tmp"
                        base2 = _ytdlp_base_flags(proxy, use_cookies=True)
                        cmd2 = (["yt-dlp"] + base2 + _pot_args(client) +
                                ["--extractor-args", f"youtube:player_client={client}",
                                 "-f", "bv*+ba/b/best/bv*/b*",
                                 "--merge-output-format", "mp4", "-o", tmp_path2, url])
                        try:
                            r2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=60)
                            produced2 = _resolve_downloaded(tmp_path2) if r2.returncode == 0 else None
                            if produced2:
                                with move_lock:
                                    if not moved.is_set():
                                        import shutil as _sh
                                        _sh.move(produced2, out_path)
                                        moved.set()
                                        winner["client"] = client
                                        logging.info("Proxy race won by %s client=%s fmt=permissive", proxy, client)
                                        return True
                            logging.warning("Proxy[%d] %s client=%s fmt-fallback found no a/v formats either",
                                            idx, proxy, client)
                        except Exception:
                            pass
                        finally:
                            import glob as _glob
                            for _f in [tmp_path2] + _glob.glob(_glob.escape(tmp_path2) + ".*"):
                                try:
                                    Path(_f).unlink(missing_ok=True)
                                except Exception:
                                    pass
                except Exception as e:
                    logging.warning("Proxy[%d] %s client=%s → exception: %s", idx, proxy, client, e)
                    with proxy_errors_lock:
                        proxy_errors.append(f"proxy[{idx}] [{client}]: {e}")
                finally:
                    # Remove the template path AND any extension-rewritten file
                    # (tmp_path + ".mp4" etc.) plus stray intermediates.
                    import glob as _glob
                    for _f in [tmp_path] + _glob.glob(_glob.escape(tmp_path) + ".*"):
                        try:
                            Path(_f).unlink(missing_ok=True)
                        except Exception:
                            pass
            return False

        # Client-MAJOR order: exhaust a high-quality client across EVERY proxy before
        # settling for a lower-quality one. `tv` carries the full HD/4K ladder — BUT
        # YouTube now runs a DRM experiment that, on many datacenter/proxy IPs, marks
        # every `tv` https format DRM-protected so only storyboard images remain
        # ("Requested format is not available"; yt-dlp #12563). `mweb` and `web_safari`
        # return the same full adaptive ladder (4K/1080p, +PO +cookies), are NOT under
        # that tv DRM experiment, and are NOT 360p-capped like plain `web` — so they sit
        # right after `tv`. Plain `web` (360p-only on these IPs) and ios go last.
        _CLIENT_TIERS = ["mweb", "web_safari", "tv", "android_vr", "web", "ios"]

        if _parallel:
            # Opt-in legacy behaviour: race all proxies in parallel batches, per client tier.
            BATCH = 10
            for client in _CLIENT_TIERS:
                for batch_start in range(0, len(proxies), BATCH):
                    batch = proxies[batch_start:batch_start + BATCH]
                    logging.info("Client=%s batch %d-%d: racing %d proxies",
                                 client, batch_start, batch_start + len(batch) - 1, len(batch))
                    with concurrent.futures.ThreadPoolExecutor(max_workers=BATCH) as ex:
                        futures = {ex.submit(_try_proxy, p, batch_start + i, [client]): p
                                   for i, p in enumerate(batch)}
                        for fut in concurrent.futures.as_completed(futures):
                            if moved.is_set():
                                return winner["client"]
                    if moved.is_set():
                        return winner["client"]
        else:
            # Default: for each client tier, try every proxy in turn; only drop to the
            # next (lower-quality) client after the current one fails on ALL proxies.
            for client in _CLIENT_TIERS:
                logging.info("Phase 1: trying client=%s across %d proxies", client, len(proxies))
                for idx, proxy in enumerate(proxies):
                    if _try_proxy(proxy, idx, [client]):
                        return winner["client"]
                    if moved.is_set():
                        return winner["client"]
                logging.info("Client=%s failed on all proxies, dropping to next client", client)
        errors.extend(proxy_errors)

    # Phase 2: direct strategies (android_vr no-cookies, then cookie-based clients)
    logging.info("Phase 2: trying direct strategies (no proxy)")
    cookie_strategies = [(cmd, _client_of(cmd)) for cmd in _client_args(None)]
    for attempt, (cmd, label) in enumerate(cookie_strategies):
        ok, stderr = _run_strategy(cmd, label, attempt)
        if ok:
            winner["client"] = label
            return winner["client"]
        errors.append(f"yt-dlp strategy {attempt+1} ({label}): {stderr[:200]}")
        if _is_bad_cookies(stderr):
            logging.error(
                "YouTube cookies are INVALID/EXPIRED/ROTATED — REFRESH yt-cookies.txt from a "
                "logged-in browser. tv_embedded/web clients cannot authenticate until then. "
                "(strategy %d, %s)", attempt + 1, label)
            break
        if _is_429(stderr) or _is_bot_blocked(stderr):
            logging.warning("YouTube 429/bot-block on direct strategy %d (%s)", attempt + 1, label)
            break

    # pytubefix as final fallback (different HTTP stack, avoids some rate-limits)
    try:
        from pytubefix import YouTube
        yt = YouTube(url, use_oauth=False, allow_oauth_cache=False)
        stream = (
            yt.streams.filter(progressive=True, file_extension="mp4")
            .order_by("resolution").desc().first()
        ) or yt.streams.filter(file_extension="mp4").order_by("resolution").desc().first()
        if stream:
            downloaded = stream.download(output_path=str(Path(out_path).parent), filename="source.mp4")
            if Path(downloaded).exists() and Path(downloaded).stat().st_size > 0:
                winner["client"] = "pytubefix"
                return winner["client"]
        errors.append("pytubefix: no suitable stream")
    except Exception as e:
        errors.append(f"pytubefix: {e}")

    # RapidAPI TikTok fallback — handles IP-blocked TikTok URLs
    rapidapi_key = os.getenv("RAPIDAPI_TIKTOK_KEY", "")
    if rapidapi_key and "tiktok" in url.lower():
        try:
            import urllib.request as _urllib_req
            import json as _json
            api_url = f"https://tiktok-video-no-watermark2.p.rapidapi.com/?url={url}&hd=1"
            req = _urllib_req.Request(api_url, headers={
                "x-rapidapi-host": "tiktok-video-no-watermark2.p.rapidapi.com",
                "x-rapidapi-key": rapidapi_key,
            })
            with _urllib_req.urlopen(req, timeout=30) as resp:
                data = _json.loads(resp.read())
            video_url = (
                data.get("data", {}).get("hdplay")
                or data.get("data", {}).get("play")
                or data.get("data", {}).get("wmplay")
            )
            if not video_url:
                raise ValueError(f"No video URL in response: {list(data.get('data', {}).keys())}")
            dl_req = _urllib_req.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
            with _urllib_req.urlopen(dl_req, timeout=120) as resp:
                with open(out_path, "wb") as f:
                    f.write(resp.read())
            if Path(out_path).stat().st_size > 0:
                winner["client"] = "rapidapi"
                return winner["client"]
            errors.append("RapidAPI TikTok: downloaded file is empty")
        except Exception as e:
            errors.append(f"RapidAPI TikTok: {e}")

    raise RuntimeError("YouTube download failed after all strategies.\n" + "\n".join(errors))


# ── Main pipeline ─────────────────────────────────────────────────────────────

def _fetch_youtube_captions(url: str, language: str = "en") -> list[WordTimestamp]:
    """Download YouTube auto/manual captions and convert to WordTimestamp list. Returns [] if unavailable."""
    import tempfile, re as _re
    lang_codes = [language, "en"] if language != "en" else ["en"]
    with tempfile.TemporaryDirectory() as tmp:
        out_tmpl = os.path.join(tmp, "cap.%(ext)s")
        for lang in lang_codes:
            for sub_type in ["--write-sub", "--write-auto-sub"]:
                try:
                    _cookies = []
                    _cf = os.getenv("YTDLP_COOKIES_FILE", "")
                    if _cf and Path(_cf).exists():
                        _cookies = ["--cookies", _cf]
                    result = subprocess.run(
                        ["yt-dlp", "--skip-download", sub_type,
                         "--sub-lang", lang, "--sub-format", "vtt",
                         "--no-check-certificate", "-o", out_tmpl] + _cookies + [url],
                        capture_output=True, text=True, timeout=30,
                    )
                    vtt_files = list(Path(tmp).glob("*.vtt"))
                    if not vtt_files:
                        continue
                    vtt_text = vtt_files[0].read_text(encoding="utf-8", errors="ignore")
                    words = _parse_vtt_to_words(vtt_text)
                    if words:
                        return words
                except Exception:
                    continue
    return []


def _parse_vtt_to_words(vtt: str) -> list[WordTimestamp]:
    """Parse VTT caption file into word-level timestamps (approximated per segment)."""
    import re as _re
    TIME_RE = _re.compile(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})")
    words: list[WordTimestamp] = []

    def to_sec(h, m, s, ms):
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    lines = vtt.splitlines()
    i = 0
    while i < len(lines):
        m = TIME_RE.match(lines[i].strip())
        if m:
            start = to_sec(*m.groups()[:4])
            end = to_sec(*m.groups()[4:])
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                # Strip VTT inline tags like <00:00:00.000><c>word</c>
                clean = _re.sub(r"<[^>]+>", "", lines[i])
                text_lines.append(clean.strip())
                i += 1
            text = " ".join(text_lines).strip()
            if not text:
                i += 1
                continue
            seg_words = text.split()
            if seg_words:
                dur = max(end - start, 0.1)
                step = dur / len(seg_words)
                for j, w in enumerate(seg_words):
                    ws = start + j * step
                    we = ws + step
                    words.append(WordTimestamp(word=w, start=round(ws, 3), end=round(we, 3)))
        else:
            i += 1
    return words


