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
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginx:alpine AS production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
EXPOSE 5173
CMD ["pnpm", "run", "dev", "--host"]
