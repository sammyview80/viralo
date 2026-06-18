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
RUN sed -i 's/listen\( \)*80;/listen 5173;/g' /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
