.PHONY: up dev down logs migrate seed reset test test-unit test-int shell psql lint format build

# ── Docker ────────────────────────────────────────────────────────────────

up:
	docker compose up -d

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

down:
	docker compose down

down-v:
	docker compose down -v

logs:
	docker compose logs -f

logs-%:
	docker compose logs -f $*

build:
	docker compose build

# ── Database ──────────────────────────────────────────────────────────────

migrate:
	docker compose exec core-service python scripts/migrate_all_tenants.py

seed:
	docker compose exec core-service python scripts/seed_db.py

reset:
	docker compose exec core-service python scripts/reset_dev.py

# ── Dev Tools ─────────────────────────────────────────────────────────────

shell:
	docker compose exec core-service bash

shell-%:
	docker compose exec $*-service bash

psql:
	docker compose exec postgres psql -U viralo

# ── Tests ─────────────────────────────────────────────────────────────────

test:
	docker compose exec core-service pytest tests/ -v

test-unit:
	docker compose exec core-service pytest tests/unit/ -v

test-int:
	docker compose exec core-service pytest tests/integration/ -v

test-e2e:
	docker compose exec core-service pytest tests/e2e/ -v

# ── Code Quality ──────────────────────────────────────────────────────────

lint:
	ruff check .
	mypy shared/ services/ workers/ nodes/

format:
	ruff format .

# ── Frontend ──────────────────────────────────────────────────────────────

fe-install:
	cd frontend && npm install

fe-dev:
	cd frontend && npm run dev

fe-build:
	cd frontend && npm run build

fe-lint:
	cd frontend && npm run lint
