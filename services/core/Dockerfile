FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS development
COPY shared/pyproject.toml ./shared/
COPY services/core/pyproject.toml ./services/core/
RUN uv pip install --system -e ./shared -e ./services/core
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY migrations/ ./migrations/
COPY alembic.ini ./alembic.ini
COPY services/core/ ./services/core/
COPY scripts/ ./scripts/
ENV PYTHONPATH=/app
CMD ["uvicorn", "core.main:app", "--host", "0.0.0.0", "--port", "8001"]

FROM base AS production
COPY shared/pyproject.toml ./shared/
COPY services/core/pyproject.toml ./services/core/
RUN uv pip install --system -e ./shared -e ./services/core
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY migrations/ ./migrations/
COPY alembic.ini ./alembic.ini
COPY services/core/ ./services/core/
COPY scripts/ ./scripts/
ENV PYTHONPATH=/app
CMD ["uvicorn", "core.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
