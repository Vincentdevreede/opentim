# Build from the repository root:
#   docker build -f apps/game/Dockerfile .

FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# Fetch dependencies from the lockfile alone, so this layer stays cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch --frozen-lockfile

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@opentim/game..."
RUN pnpm --filter @opentim/game build

FROM nginx:stable-alpine
COPY apps/game/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/game/dist /usr/share/nginx/html
EXPOSE 80
