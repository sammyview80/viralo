#!/usr/bin/env bash
# Phase 4 E2E Test — AI Agent brainstorm session full flow
# Tests: register → login → create session → run session → poll status → get results + messages
# Requires: all services + celery-agent running, LLM key set in .env (GROQ_API_KEY recommended)

set -euo pipefail

CORE="http://localhost:8001"
AGENT="http://localhost:8004"
SUBDOMAIN="e2etest$(date +%s)"
EMAIL="e2e+${SUBDOMAIN}@viralo.test"
PASSWORD="E2eTest1234!"
TOPIC="Short-form fitness videos for Gen Z"
MAX_POLL=60
POLL_INTERVAL=5

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${CYAN}→${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

# ── 1. Health checks ─────────────────────────────────────────────────────────
info "1. Health checks"
CORE_HEALTH=$(curl -sf "${CORE}/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])" 2>/dev/null) || fail "core-service health check failed"
AGENT_HEALTH=$(curl -sf "${AGENT}/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])" 2>/dev/null) || fail "agent-service health check failed"
pass "core=${CORE_HEALTH} agent=${AGENT_HEALTH}"

# ── 2. Register ───────────────────────────────────────────────────────────────
info "2. Register (subdomain=${SUBDOMAIN})"
REGISTER=$(curl -sf -X POST "${CORE}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"full_name\":\"E2E Tester\",\"subdomain\":\"${SUBDOMAIN}\"}")
ACCESS_TOKEN=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
TENANT_ID=$(echo "$REGISTER" | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant_id'])")
[[ -n "$ACCESS_TOKEN" ]] || fail "No access_token in register response"
pass "registered tenant=${TENANT_ID}"

AUTH_HEADER="Authorization: Bearer ${ACCESS_TOKEN}"
HOST_HEADER="X-Tenant-ID: ${TENANT_ID}"

# ── 3. Create brainstorm session ──────────────────────────────────────────────
info "3. Create session (topic='${TOPIC}')"
SESSION=$(curl -sf -X POST "${AGENT}/api/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "${AUTH_HEADER}" \
  -H "${HOST_HEADER}" \
  -d "{\"topic\":\"${TOPIC}\"}")
SESSION_ID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
SESSION_STATUS=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
[[ -n "$SESSION_ID" ]] || fail "No session id"
[[ "$SESSION_STATUS" == "draft" ]] || fail "Expected status=draft, got ${SESSION_STATUS}"
pass "session=${SESSION_ID} status=${SESSION_STATUS}"

# ── 4. List sessions ──────────────────────────────────────────────────────────
info "4. List sessions"
LIST=$(curl -sf "${AGENT}/api/v1/sessions" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}")
TOTAL=$(echo "$LIST" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])")
[[ "$TOTAL" -ge 1 ]] || fail "Expected ≥1 session in list, got ${TOTAL}"
pass "total sessions=${TOTAL}"

# ── 5. Run session ────────────────────────────────────────────────────────────
info "5. Enqueue session run"
RUN=$(curl -sf -X POST "${AGENT}/api/v1/sessions/${SESSION_ID}/run" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}")
RUN_STATUS=$(echo "$RUN" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
[[ "$RUN_STATUS" == "queued" ]] || fail "Expected status=queued, got ${RUN_STATUS}"
pass "enqueued"

# ── 6. Docker logs: celery-agent ──────────────────────────────────────────────
info "6. Tailing celery-agent logs (5s)"
docker compose logs --tail=30 celery-agent 2>&1 | grep -E "session|task|ERROR|SUCCESS|WARN" | head -20 || warn "No matching log lines yet"

# ── 7. Poll until complete/failed ─────────────────────────────────────────────
info "7. Polling session status (max ${MAX_POLL}x ${POLL_INTERVAL}s = $((MAX_POLL * POLL_INTERVAL))s)"
FINAL_STATUS=""
for i in $(seq 1 $MAX_POLL); do
  STATUS_RESP=$(curl -sf "${AGENT}/api/v1/sessions/${SESSION_ID}" \
    -H "${AUTH_HEADER}" -H "${HOST_HEADER}")
  STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  AGENT_NOW=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('current_agent') or '')" 2>/dev/null || echo "")
  echo "  poll ${i}: status=${STATUS} agent=${AGENT_NOW}"

  if [[ "$STATUS" == "complete" || "$STATUS" == "failed" ]]; then
    FINAL_STATUS="$STATUS"
    break
  fi
  sleep $POLL_INTERVAL
done

[[ -n "$FINAL_STATUS" ]] || fail "Session never reached complete/failed after $((MAX_POLL * POLL_INTERVAL))s"

# ── 8. Docker logs: agent-service + celery-agent ─────────────────────────────
info "8. Recent docker logs"
echo "--- agent-service ---"
docker compose logs --tail=50 agent-service 2>&1 | grep -E "session|ERROR|WARN" | tail -20 || true
echo "--- celery-agent ---"
docker compose logs --tail=50 celery-agent 2>&1 | tail -30 || true

if [[ "$FINAL_STATUS" == "failed" ]]; then
  fail "Session ${SESSION_ID} failed — check celery-agent logs above"
fi
pass "session completed"

# ── 9. Get results ────────────────────────────────────────────────────────────
info "9. Get results"
RESULTS=$(curl -sf "${AGENT}/api/v1/sessions/${SESSION_ID}/results" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}")
NICHE=$(echo "$RESULTS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('niche_verdict','')[:120])")
IDEAS=$(echo "$RESULTS" | python3 -c "import sys,json; d=json.load(sys.stdin); ideas=d.get('video_ideas') or []; print(len(ideas) if isinstance(ideas, list) else 'non-list')")
[[ -n "$NICHE" ]] || warn "niche_verdict empty"
pass "niche_verdict='${NICHE}'"
pass "video_ideas count=${IDEAS}"

# ── 10. Get messages ──────────────────────────────────────────────────────────
info "10. Get agent messages"
MSGS=$(curl -sf "${AGENT}/api/v1/sessions/${SESSION_ID}/messages" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}")
MSG_TOTAL=$(echo "$MSGS" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])")
pass "messages total=${MSG_TOTAL}"

# ── 11. Fork session ──────────────────────────────────────────────────────────
info "11. Fork session"
FORK=$(curl -sf -X POST "${AGENT}/api/v1/sessions/${SESSION_ID}/fork" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}")
FORK_ID=$(echo "$FORK" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
FORK_NAME=$(echo "$FORK" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
[[ "$FORK_ID" != "$SESSION_ID" ]] || fail "Fork ID same as original"
pass "fork=${FORK_ID} name='${FORK_NAME}'"

# ── 12. Delete sessions (cleanup) ────────────────────────────────────────────
info "12. Cleanup"
curl -sf -X DELETE "${AGENT}/api/v1/sessions/${SESSION_ID}" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}" && pass "deleted original"
curl -sf -X DELETE "${AGENT}/api/v1/sessions/${FORK_ID}" \
  -H "${AUTH_HEADER}" -H "${HOST_HEADER}" && pass "deleted fork"

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  Phase 4 E2E PASSED${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
