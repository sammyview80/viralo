# TODO — Viralo backend

Tracked follow-ups for AI agents and humans. Keep entries short: what,
why, where. Remove when done (git history keeps the "when done" record).

## Deploy pipeline

- **Move `alembic upgrade head` out of app startup into a real deploy
  step.** `services/core/core/main.py`'s `lifespan()` currently runs
  migrations as a subprocess every time the app boots, guarded by a
  Postgres advisory lock (added in `fix/migration-race-condition`) so
  concurrent uvicorn workers don't race each other. That lock is a
  correct workaround, not the real fix — the real fix is running
  migrations exactly once, before any app process starts, via one of:
  - an init container in the deploy manifest, or
  - a pre-deploy CI/CD job step, or
  - an entrypoint script that runs `alembic upgrade head` once and only
    then execs `uvicorn`.
  Needs a deploy-pipeline change (not just app code), so it's deferred.
  Owner: unassigned. Priority: medium (current workaround is safe, just
  not architecturally clean).

## LLM cost tracking

- Explicitly out of scope for the admin panel PR (#65) per user
  decision. Revisit if/when cost visibility becomes a priority — needs
  a `llm_usage` table + a per-request cost-recording hook wherever LLM
  calls are made (agent service, video pipeline, etc.) and a pricing
  table per provider/model.

## Admin panel — accepted limitations (not bugs, just known)

- Tier upgrade/downgrade from `/admin` is a **local-only override** —
  does not call Stripe. A later Stripe webhook can silently overwrite
  it, and it can grant paid access without real payment. Documented in
  `services/core/core/routers/admin.py` docstring. Full Stripe
  reconciliation is a separate, larger piece of work if ever needed.
