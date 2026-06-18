FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS development
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nodejs npm \
    && rm -rf /var/lib/apt/lists/*
# Update yt-dlp to latest; curl_cffi enables TikTok impersonation
RUN pip install -U yt-dlp curl_cffi
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/video/ ./services/video/
RUN uv pip install --system -e ./shared -e ./services/video
ENV PYTHONPATH=/app
CMD ["uvicorn", "video.main:app", "--host", "0.0.0.0", "--port", "8003"]

FROM base AS production
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nodejs npm \
    && rm -rf /var/lib/apt/lists/*
# Update yt-dlp to latest; curl_cffi enables TikTok impersonation
RUN pip install -U yt-dlp curl_cffi
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/video/ ./services/video/
RUN uv pip install --system -e ./shared -e ./services/video
ENV PYTHONPATH=/app
CMD ["uvicorn", "video.main:app", "--host", "0.0.0.0", "--port", "8003", "--workers", "2"]
