FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
EXPOSE 5173
CMD ["pnpm", "run", "dev", "--host"]

FROM base AS builder
ARG VITE_API_BASE
ARG VITE_VIDEO_BASE
ARG VITE_AGENT_BASE
ARG VITE_PLATFORM_BASE
ARG VITE_OAUTH_REDIRECT
ARG VITE_YOUTUBE_CLIENT_ID
ARG VITE_FB_APP_ID
ARG VITE_IG_CLIENT_ID
ARG VITE_LI_CLIENT_ID
ARG VITE_TWITTER_KEY
ARG VITE_TIKTOK_KEY
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_VIDEO_BASE=$VITE_VIDEO_BASE \
    VITE_AGENT_BASE=$VITE_AGENT_BASE \
    VITE_PLATFORM_BASE=$VITE_PLATFORM_BASE \
    VITE_OAUTH_REDIRECT=$VITE_OAUTH_REDIRECT \
    VITE_YOUTUBE_CLIENT_ID=$VITE_YOUTUBE_CLIENT_ID \
    VITE_FB_APP_ID=$VITE_FB_APP_ID \
    VITE_IG_CLIENT_ID=$VITE_IG_CLIENT_ID \
    VITE_LI_CLIENT_ID=$VITE_LI_CLIENT_ID \
    VITE_TWITTER_KEY=$VITE_TWITTER_KEY \
    VITE_TIKTOK_KEY=$VITE_TIKTOK_KEY
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
