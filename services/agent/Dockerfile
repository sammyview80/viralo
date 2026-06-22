FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS development
COPY shared/pyproject.toml ./shared/
COPY services/agent/pyproject.toml ./services/agent/
RUN uv pip install --system -e ./shared -e ./services/agent
COPY shared/ ./shared/
COPY services/agent/pyproject.toml ./services/agent/
RUN uv pip install --system -e ./shared -e ./services/agent
COPY workers/ ./workers/
COPY services/agent/ ./services/agent/
ENV PYTHONPATH=/app
CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8004"]

FROM base AS production
COPY shared/pyproject.toml ./shared/
COPY services/agent/pyproject.toml ./services/agent/
RUN uv pip install --system -e ./shared -e ./services/agent
COPY shared/ ./shared/
COPY services/agent/pyproject.toml ./services/agent/
RUN uv pip install --system -e ./shared -e ./services/agent
COPY workers/ ./workers/
COPY services/agent/ ./services/agent/
ENV PYTHONPATH=/app
CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8004", "--workers", "2"]
