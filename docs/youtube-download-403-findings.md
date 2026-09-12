# YouTube Download Failure — Findings & Fix

**Date:** 2026-09-12
**Reported as:** "video download blocked / IP blocked"
**Failing video:** `njBnqiiTeZo` ("Nepal Flash Flood 2026") — public, not age-restricted
**Outcome:** root cause was **not** the proxy or the IP. Four distinct defects found; all four fixed and verified live.

---

## TL;DR

The rotating proxy was working perfectly the whole time. The download failed because the
**PO-token provider was minting tokens that YouTube rejected with `403 Forbidden`**.

Proof — identical command, single variable changed:

| PO token | Result |
|---|---|
| **With** POT | `403 Forbidden` on all 12 proxies |
| **Without** POT | **48,335,907 bytes downloaded** |

---

## Investigation technique

The reason this took several passes is that each "obvious" cause tested *clean*. The
technique that finally isolated it was **progressive variable elimination against the
real failing input** — never against a convenient substitute.

### The rule that mattered most

> Reproduce with the **exact** failing input, from the **exact** failing environment,
> using the **exact** failing code path.

Every early test passed because I violated one of those three. Specifically:

1. I first tested a **different video** (`jNQXAC9IVRw`) — it downloaded fine, which
   wrongly suggested the pipeline config was broken rather than the request itself.
2. I then tested **my own simplified yt-dlp flags** — also fine, because my flags
   omitted the PO-token args the pipeline adds.
3. Only when I imported the **pipeline's own helpers** (`_ytdlp_base_flags`,
   `_pot_args`) and replayed its literal argv did the failure reproduce.

### The elimination ladder

Each rung was a single-variable A/B against the failing video, run from inside the
production worker container:

| # | Hypothesis | Test | Result |
|---|---|---|---|
| 1 | Proxy credentials invalid | proxied fetch to `api.ipify.org` | ❌ ruled out — auth OK, IPs rotate |
| 2 | Server IP blocked | direct vs proxied | ✅ IP *is* blocked, but proxy bypasses it |
| 3 | Cookies missing/expired | download ±`--cookies` | ❌ ruled out — worked both ways |
| 4 | Video restricted | `availability`/`age_limit` probe | ❌ ruled out — `public|0|not_live` |
| 5 | Client type wrong | mweb/android/ios/web/tv matrix | partial — `ios`/`web` fail, `mweb`/`android` work |
| 6 | POT provider down | `/ping` + plugin check | ❌ ruled out — healthy, `200`, plugin loaded |
| 7 | **POT token rejected** | pipeline argv ±`_pot_args()` | ✅ **ROOT CAUSE** |

Hypothesis 6 is the trap worth remembering: **a healthy provider is not a valid
provider.** `/ping` returning `200` only proves the service is alive — it says nothing
about whether the tokens it mints are *accepted by YouTube*. Liveness ≠ correctness.

### Why the logs pointed the wrong way

The pipeline reported `403 Forbidden` identically across all 12 proxies. That pattern
reads exactly like an IP-reputation problem, which is why the proxy was suspected first.
The tell was that the failure was **too uniform** — 12 unrelated residential IPs across
different countries failing in exactly the same way is not how IP blocks behave. A real
IP block is patchy; a request-signature rejection is uniform.

---

## Findings

### 1. PO tokens rejected by YouTube (root cause — download failure)

`_pot_args()` attaches a bgutil-minted Proof-of-Origin token for `mweb`/`web`/`tv`
clients. The provider was healthy, but YouTube rejected its tokens on the media
request. Because every proxy sent the same bad token, all 12 failed identically, and
the task exhausted the whole pool per client tier before giving up on a video that was
downloadable the entire time.

### 2. Direct-IP fallback leaked the real server IP (severity: high)

Every client tier was built as:

```python
("mweb", [None] + all_proxies[:hd_tries]),   # None == direct connection
```

`None` means "connect from this server's own IP" — and it ran **first**, ahead of
every proxy, on **all six tiers**. That IP is already bot-blocked, so those attempts
could never succeed; worse, each one re-identified the origin server to YouTube,
actively undermining the rotating pool it was supposed to hide behind.

### 3. Proxy credentials written to logs in plaintext (severity: high)

```
Proxy[0] http://bjhcnjum…:y84s5ckl1y4j@p.webshare.io:80 client=mweb → failed
```

Seven call sites logged the full proxy URL, exposing the Webshare username and
password to anyone with log access or any log shipper.

### 4. `.env` world-readable (severity: high, fixed separately)

`/services/viralo/dev/.env` was mode `0644` — every user and container process on the
host could read the Webshare password, SMTP credentials, and database connection
string. Corrected to `0600`.

---

## Fixes

| # | Change | File |
|---|---|---|
| 1 | Retry once **without PO tokens** when a token-rejection 403 is seen | `download.py` |
| 2 | `_is_pot_rejected()` — 403 detector that defers to bot-block/429 | `cookies.py` |
| 3 | Never use direct connection when proxies are configured | `download.py` |
| 4 | `_redact_proxy()` applied at all 7 logging sites | `cookies.py`, `download.py` |

### Detector precedence (deliberate)

`_is_pot_rejected()` returns `False` for bot-blocks and 429s, even when a 403 is also
present. Dropping PO tokens cannot fix an IP-reputation problem, so misclassifying one
would hide a real failure behind a pointless retry. Bot-block and rate-limit checks run
**first**.

### Direct-connection policy

Direct is permitted **only** when no proxies are configured at all — otherwise local and
CI runs with an empty pool would break. With a pool present, direct is never attempted.

---

## Verification

**Unit assertions:** 27/27 passed (run inside the prod image, Python 3.12).

**End-to-end**, patched code against the real failing video through the live proxy pool:

```json
{
  "produced": true,
  "downloaded": true,
  "bytes": 48335907,
  "log_leaks_password": false,
  "log_leaks_username": false,
  "log_has_redacted_marker": true,
  "used_nopot_retry": true
}
```

`used_nopot_retry: true` confirms the new code path was actually exercised — not
bypassed by a lucky success.

---

## Reusable lessons

1. **Test the failing input, not a similar one.** A working sample proves nothing about
   a failing one.
2. **Replay the real argv.** Hand-written test commands silently omit the flags that
   cause the bug. Import the production helpers.
3. **Health check ≠ correctness.** `/ping 200` means alive, not *producing valid output*.
4. **Uniform failure across diverse IPs is a request-signature problem, not an IP
   problem.** Patchy failure suggests IP reputation; identical failure suggests
   something in the request itself.
5. **Logs are not a secret store.** Any variable that may contain credentials needs a
   redaction helper at every call site, not just the obvious one.
6. **Never silently fall back to the identity you are trying to hide.** A `None` proxy
   in a rotation list defeats the purpose of rotating.
