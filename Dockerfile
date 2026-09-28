# syntax=docker/dockerfile:1
# Finesse — the app, its server, and the conductor for the whole media stack.
#
#   docker build -t finesse .                       # full build (CI / release)
#   docker build --target prebuilt -t finesse:dev . # reuse a local `npm run build && npm run server:build`

# ---------- build (runs natively on the builder, whatever the target arch) ----------
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run server:build

# ---------- runtime base ----------
FROM node:22-alpine AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Finesse" \
      org.opencontainers.image.description="A premium Jellyfin app plus a self-maintaining media server stack in one install" \
      org.opencontainers.image.source="https://github.com/CoffeeCC/finesse" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    FINESSE_WEB_DIR=/app/web \
    FINESSE_CONFIG_DIR=/config \
    PORT=8080 \
    FINESSE_IN_DOCKER=1
WORKDIR /app
# `finesse` CLI (setup-code, setup apply/status, doctor) on the PATH.
RUN printf '#!/bin/sh\nexec node --disable-warning=ExperimentalWarning /app/server/finesse.mjs "$@"\n' > /usr/local/bin/finesse \
 && chmod +x /usr/local/bin/finesse
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server/finesse-server.mjs"]

# ---------- local image from prebuilt artifacts ----------
FROM runtime AS prebuilt
COPY dist /app/web
COPY server/dist /app/server

# ---------- release image (default target) ----------
FROM runtime AS release
COPY --from=build /src/dist /app/web
COPY --from=build /src/server/dist /app/server
