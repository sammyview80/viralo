FROM python:3.12-slim AS base
WORKDIR /app
RUN pip install uv

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nodejs npm curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/nodejs /usr/local/bin/node
# Deno: yt-dlp's default JS runtime for solving YouTube's n-challenge. Without a
# JS runtime, tv/web clients return no formats ("No supported JavaScript runtime
# could be found. Only deno is enabled by default"). Installed to /usr/local/bin
# so yt-dlp auto-discovers it on PATH.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y \
    && /usr/local/bin/deno --version
# yt-dlp nightly tracks YouTube extractor changes; bgutil plugin mints PO tokens
# (Proof-of-Origin) that web/tv/mweb clients now require to return formats.
# bgutil plugin version MUST match the bgutil-pot server image tag (1.3.1).
RUN pip install -U --pre "yt-dlp[default]" curl_cffi "bgutil-ytdlp-pot-provider==1.3.1"

FROM deps AS development
COPY shared/pyproject.toml ./shared/
COPY services/video/pyproject.toml ./services/video/
RUN uv pip install --system -e ./shared -e ./services/video
COPY shared/ ./shared/
COPY workers/ ./workers/
COPY services/video/ ./services/video/
COPY yt-cookies.txt /app/yt-cookies.txt
RUN uv pip install --system -e ./shared -e ./services/video
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
RUN uv pip install --system -e ./shared -e ./services/video
ENV PYTHONPATH=/app
CMD ["uvicorn", "video.main:app", "--host", "0.0.0.0", "--port", "8003", "--workers", "2"]
