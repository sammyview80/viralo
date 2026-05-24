FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS development
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/workflow/ ./services/workflow/
RUN uv pip install --system -e ./shared -e ./services/workflow
ENV PYTHONPATH=/app
CMD ["uvicorn", "workflow.main:app", "--host", "0.0.0.0", "--port", "8005"]

FROM base AS production
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/workflow/ ./services/workflow/
RUN uv pip install --system -e ./shared -e ./services/workflow
ENV PYTHONPATH=/app
CMD ["uvicorn", "workflow.main:app", "--host", "0.0.0.0", "--port", "8005", "--workers", "2"]
