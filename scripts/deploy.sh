#!/usr/bin/env bash
#
# One-command deploy for the viralo stack.
#
# Why this exists: the server has no CI/watchtower and code is baked into the
# Docker images at build time, so a plain `git pull` runs the OLD image. This
# script makes deploys deterministic — sync the working tree to origin/dev
# exactly (no merge conflicts that silently drop changes), rebuild, recreate.
#
# Usage:  ./scripts/deploy.sh [service ...]
#   no args  -> rebuild + recreate everything
#   args     -> only those compose services (e.g. ./scripts/deploy.sh celery-video-pipeline celery-video-ai)
#
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="${DEPLOY_BRANCH:-dev}"
SERVICES=("$@")

echo "→ preserving live cookies / local env"
cp -f yt-cookies.txt /tmp/yt-cookies.live.bak 2>/dev/null || true

echo "→ hard-syncing working tree to origin/${BRANCH} (source of truth)"
git fetch origin
git checkout -B "${BRANCH}" "origin/${BRANCH}"
git reset --hard "origin/${BRANCH}"

# Keep the LIVE rotating cookie file, not the (possibly stale) committed one.
cp -f /tmp/yt-cookies.live.bak yt-cookies.txt 2>/dev/null || true

echo "→ building images at $(git rev-parse --short HEAD)"
docker compose build "${SERVICES[@]}"

echo "→ recreating containers from the fresh images"
docker compose up -d --force-recreate "${SERVICES[@]}"

echo "✓ deployed ${BRANCH}@$(git rev-parse --short HEAD)"
