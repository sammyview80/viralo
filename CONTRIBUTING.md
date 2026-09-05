# Contributing to Viralo

Thanks for considering a contribution. Viralo is a FastAPI microservices + React/Vite monorepo — this guide gets you from clone to merged PR.

## Getting set up

```bash
git clone https://github.com/sammyview80/viralo.git
cd viralo
./scripts/install.sh      # one-command local stack (see README.md)
```

For hot-reload local dev instead of the prebuilt images:

```bash
make dev
```

## Branching & PRs

- Base branch is `dev`, not `main`. Branch off `dev`:
  ```bash
  git checkout dev && git pull
  git checkout -b feat/short-description   # or fix/..., chore/...
  ```
- Keep PRs scoped to one change. Large unrelated diffs slow down review and are harder to revert if something breaks.
- Write a clear PR description: what changed, why, and how you verified it (commands run, screenshots for UI changes).
- Rebase/merge `dev` into your branch before requesting review if it's gone stale.
- One approval + green CI required before merge. Squash-merge preferred to keep `dev` history readable.

## Before you open a PR

```bash
make lint            # ruff check + mypy
make format           # ruff format
make test             # full backend test suite
make fe-lint           # frontend typecheck
```

Run only the subset relevant to what you touched if the full suite is slow locally — but CI runs everything, so don't skip file-relevant checks.

## Code conventions

- **Service boundaries**: each domain (`core`, `video`, `agent`, `workflow`, `platform`) is its own FastAPI service under `services/`. Don't reach across service boundaries by importing another service's internals or hitting its DB tables directly — call its HTTP API or go through `shared/`.
- **Shared code** (models, utils, clients used by 2+ services) belongs in `shared/`, not duplicated per-service.
- **Celery tasks** live in `workers/tasks/`; one module per domain area, registered on the app in `workers/celery_app.py`.
- **Config/secrets**: every new required environment variable must be added to `.env.example` with a comment explaining what it's for and how to generate it (see existing entries for the pattern). Untested/missing env vars are the #1 cause of "works on my machine" — an env var that's required by code but absent from `.env.example` will crash-loop containers on a fresh install.
- Keep files reasonably sized and single-purpose; prefer editing an existing file in the right place over bolting new logic onto an unrelated module.
- Validate input at system boundaries (API routes, task entrypoints) — don't trust upstream data.

## Tests

- Backend: `pytest`, configured in `pyproject.toml` (`testpaths = ["services", "workers", "tests"]`).
- Skip writing tests for pure config/docs/YAML changes — there's no behavior to test.
- Any change with real logic (new endpoint, task, business rule) needs a test that would fail without the fix/feature.
- Frontend: `frontend/` uses `vitest` (`npm test` inside `frontend/`).

## Security

- Never commit `.env`, API keys, tokens, or any live secret. `.gitignore` already excludes `.env*`; keep it that way.
- Don't log PII, tokens, or full request/response bodies containing user data.
- If you find a security issue, do **not** open a public issue — see [Security](#security) below.

## Reporting bugs / requesting features

Open a GitHub issue with:
- what you expected vs what happened,
- exact repro steps (commands, inputs),
- relevant logs (`docker compose logs <service>`), redacted of secrets,
- your environment (OS, Docker version).

## Security

Report vulnerabilities privately — do not open a public issue. Email the maintainer (see repository owner contact on GitHub) with details; you'll get a response and credit once it's patched.

## License

By contributing, you agree your contributions are licensed under the Apache License 2.0 (see `LICENSE`), the same license as the rest of the project.
