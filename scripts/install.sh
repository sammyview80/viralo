#!/usr/bin/env bash
#
# Viralo — one-click installer for a local/self-hosted deployment.
#
# What it does:
#   1. Checks Docker + Docker Compose are present.
#   2. Creates .env from .env.example if missing.
#   3. Auto-generates strong secrets (DB password, RabbitMQ password,
#      SECRET_KEY, ENCRYPTION_KEY, ADMIN_JWT_SECRET) and wires them into
#      every place they're referenced (DATABASE_URL, RABBITMQ_URL).
#   4. Builds and starts the full stack with Docker Compose.
#   5. Waits for core services to report healthy, then prints the URLs.
#
# Usage:
#   ./scripts/install.sh              # interactive-safe, non-destructive
#   curl -fsSL https://raw.githubusercontent.com/<org>/viralo/main/scripts/install.sh | bash
#
# Safe to re-run: never overwrites an existing .env or its secrets.

set -euo pipefail
cd "$(dirname "$0")/.."

info()  { printf '\033[1;34m→\033[0m %s\n' "$1"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$1"; }
fail()  { printf '\033[1;31m✗\033[0m %s\n' "$1"; exit 1; }

# ── 1. Prerequisites ─────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "Docker is required. Install: https://docs.docker.com/get-docker/"
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  fail "Docker Compose is required (docker compose plugin or docker-compose binary)."
fi
ok "Docker + Compose found ($COMPOSE)"

# ── 2. .env bootstrap ─────────────────────────────────────────────────────
gen_hex()    { python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null || openssl rand -hex 32; }
gen_fernet() { python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null \
               || python3 -c "import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"; }

if [ -f .env ]; then
  info ".env already exists — leaving your secrets untouched."
  if ! grep -q "^SELF_HOSTED=" .env; then
    echo "SELF_HOSTED=true" >> .env
    ok "Added SELF_HOSTED=true to existing .env — billing/plan gates disabled."
  fi
else
  info "Creating .env from .env.example"
  cp .env.example .env

  DB_PASS=$(gen_hex)
  MQ_PASS=$(gen_hex)
  SECRET_KEY=$(gen_hex)
  ENCRYPTION_KEY=$(gen_fernet)
  ADMIN_JWT_SECRET=$(gen_hex)
  WEBSUB_SECRET=$(gen_hex)

  # macOS/BSD sed vs GNU sed both accept `sed -i.bak` then delete the backup.
  sedi() { sed -i.bak "$1" .env && rm -f .env.bak; }

  sedi "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${DB_PASS}#"
  sedi "s#^RABBITMQ_PASS=.*#RABBITMQ_PASS=${MQ_PASS}#"
  sedi "s#^SECRET_KEY=.*#SECRET_KEY=${SECRET_KEY}#"
  sedi "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=${ENCRYPTION_KEY}#"
  sedi "s#^ADMIN_JWT_SECRET=.*#ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}#"
  sedi "s#^WEBSUB_SECRET=.*#WEBSUB_SECRET=${WEBSUB_SECRET}#"
  sedi "s#^DATABASE_URL=.*#DATABASE_URL=postgresql+asyncpg://viralo:${DB_PASS}@postgres:5432/viralo#"
  sedi "s#^RABBITMQ_URL=.*#RABBITMQ_URL=amqp://viralo:${MQ_PASS}@rabbitmq:5672//#"

  ok "Generated secrets and wrote .env"
  echo "  → Add your LLM/storage API keys to .env later (optional for first boot):"
  echo "    OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, CLOUDINARY_URL, etc."
fi

touch yt-cookies.txt

# ── 3. Build + start ─────────────────────────────────────────────────────
info "Building images (first run can take several minutes)…"
$COMPOSE build

info "Starting the stack…"
$COMPOSE up -d

# ── 4. Wait for health ────────────────────────────────────────────────────
info "Waiting for core services to become healthy…"
CHECK_SERVICES=(postgres redis rabbitmq core-service frontend)
ATTEMPTS=60
for i in $(seq 1 "$ATTEMPTS"); do
  ALL_HEALTHY=true
  for svc in "${CHECK_SERVICES[@]}"; do
    CID=$($COMPOSE ps -q "$svc" 2>/dev/null || true)
    [ -z "$CID" ] && { ALL_HEALTHY=false; break; }
    STATUS=$(docker inspect --format '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo "unknown")
    [ "$STATUS" != "healthy" ] && { ALL_HEALTHY=false; break; }
  done
  $ALL_HEALTHY && break
  sleep 5
  [ "$i" -eq "$ATTEMPTS" ] && info "Still starting up — check '$COMPOSE ps' / '$COMPOSE logs -f' if this takes much longer."
done

if $ALL_HEALTHY; then
  ok "All core services are healthy"
else
  info "Stack is up but not all health checks passed yet — it may still be warming up."
fi

echo
ok "Viralo is running:"
echo "    Frontend:      http://localhost:3000"
echo "    Core API:      http://localhost:8001"
echo "    Billing:       disabled (SELF_HOSTED=true) — every feature unlocked, no plan limits"
echo
echo "  Next steps:"
echo "    - Logs:         $COMPOSE logs -f"
echo "    - Stop:         $COMPOSE down"
echo "    - Reset data:   $COMPOSE down -v"
echo "    - Add API keys: edit .env, then '$COMPOSE up -d --force-recreate'"
