# syntax=docker/dockerfile:1.7
#
# Targets:
#   runtime (default) - the API on distroless Node.js, non-root, works with a read-only root filesystem
#   migrate           - runs `prisma migrate deploy` (Kubernetes Job / Argo CD PreSync hook)
#
# Production images are built for linux/amd64 (the account's SCP only allows x86 instances).

ARG NODE_MAJOR=22

# --- base: Debian slim with OpenSSL, needed by the Prisma engines -------------------------
FROM node:${NODE_MAJOR}-trixie-slim AS base
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NX_DAEMON=false \
    NX_NO_CLOUD=true
WORKDIR /app

# --- deps: all dependencies (cached until package*.json change) ---------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- build: compile, then keep production dependencies only -------------------------------
FROM deps AS build
COPY . .
RUN npx prisma generate \
 && npx nx build api --configuration=production --skip-nx-cache \
 && npm prune --omit=dev --no-audit --no-fund
# Amazon RDS CA bundle, so the API can verify the database certificate (sslaccept=strict).
# ADD from a URL creates a root-only (0600) file; the non-root runtime user must be able to read it.
ADD --chmod=0644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem

# --- migrate: Prisma CLI + migrations only --------------------------------------------------
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/certs ./certs
COPY package.json ./
COPY src/prisma ./src/prisma
USER node
ENTRYPOINT ["node_modules/.bin/prisma", "migrate", "deploy"]

# --- runtime ---------------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs${NODE_MAJOR}-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/api ./dist
COPY --from=build /app/certs ./certs
USER nonroot
EXPOSE 3000
# distroless/nodejs's entrypoint is node itself.
CMD ["dist/main.js"]
