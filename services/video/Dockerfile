FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nodejs npm \
    && rm -rf /var/lib/apt/lists/*
RUN pip install yt-dlp curl_cffi

FROM deps AS development
COPY shared/pyproject.toml ./shared/
COPY services/video/pyproject.toml ./services/video/
RUN uv pip install --system -e ./shared -e ./services/video
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/video/ ./services/video/
COPY yt-cookies.txt /app/yt-cookies.txt
ENV PYTHONPATH=/app
CMD ["uvicorn", "video.main:app", "--host", "0.0.0.0", "--port", "8003"]

FROM deps AS production
COPY shared/pyproject.toml ./shared/
COPY services/video/pyproject.toml ./services/video/
RUN uv pip install --system -e ./shared -e ./services/video
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/video/ ./services/video/
COPY yt-cookies.txt /app/yt-cookies.txt
ENV PYTHONPATH=/app
CMD ["uvicorn", "video.main:app", "--host", "0.0.0.0", "--port", "8003", "--workers", "2"]
