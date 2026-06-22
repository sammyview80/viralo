FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS development
COPY shared/pyproject.toml ./shared/
COPY services/platform/pyproject.toml ./services/platform/
RUN uv pip install --system -e ./shared -e ./services/platform
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/platform/ ./services/platform/
RUN uv pip install --system -e ./shared -e ./services/platform
ENV PYTHONPATH=/app
CMD ["uvicorn", "platform_svc.main:app", "--host", "0.0.0.0", "--port", "8006"]

FROM base AS production
COPY shared/pyproject.toml ./shared/
COPY services/platform/pyproject.toml ./services/platform/
RUN uv pip install --system -e ./shared -e ./services/platform
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/platform/ ./services/platform/
RUN uv pip install --system -e ./shared -e ./services/platform
ENV PYTHONPATH=/app
CMD ["uvicorn", "platform_svc.main:app", "--host", "0.0.0.0", "--port", "8006", "--workers", "2"]
