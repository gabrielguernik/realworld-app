# syntax=docker/dockerfile:1.7
#
# Targets:
#   runtime (default) - the API on distroless Node.js, non-root, works with a read-only root filesystem
#   migrate           - runs `prisma migrate deploy` (Kubernetes Job / Argo CD Sync hook, wave 0)
#
# Production images are built for linux/amd64 (the account's SCP only allows x86 instances).
# Base images are pinned by digest (the tag is for readers); update both together.

# --- base: Debian slim with OpenSSL, needed by the Prisma engines -------------------------
FROM node:22-trixie-slim@sha256:28d03803f09ba76560e273af33beb7eda4ed68fa0698bc9bd15e9a6e35693923 AS base
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
# RDS root CA, so the API can verify the database certificate (sslaccept=strict).
# Prisma's engine reads only the FIRST certificate of `sslcert`, so a multi-CA bundle does not work: extract
# exactly the root of the CA the instance uses (infra pins ca_cert_identifier = rds-ca-rsa2048-g1).
ARG RDS_REGION=us-east-1
ARG RDS_CA_CN="Amazon RDS ${RDS_REGION} Root CA RSA2048 G1"
# The checksum pins the bundle: if AWS changes it, the build fails until the new bundle is reviewed.
ADD --chmod=0644 --checksum=sha256:b1711d12bae51838581281e23b6cb97b1074016873b4dafc80ed14002462dd77 https://truststore.pki.rds.amazonaws.com/${RDS_REGION}/${RDS_REGION}-bundle.pem /tmp/rds-bundle.pem
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN mkdir -p /app/certs /tmp/rdsca \
 && csplit -s -z -f /tmp/rdsca/cert- /tmp/rds-bundle.pem '/-----BEGIN CERTIFICATE-----/' '{*}' \
 && for f in /tmp/rdsca/cert-*; do \
      if openssl x509 -in "$f" -noout -subject -nameopt multiline | grep -qx "    commonName *= *${RDS_CA_CN}"; then \
        install -m 0644 "$f" /app/certs/rds-ca.pem; \
      fi; \
    done \
 && openssl x509 -in /app/certs/rds-ca.pem -noout -subject

# --- migrate-cli: only the Prisma CLI, at the version locked in package-lock.json -------------
FROM base AS migrate-cli
WORKDIR /prisma-cli
COPY package-lock.json /tmp/
# hadolint ignore=DL3016
RUN version="$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" \
 && npm install --no-save --no-package-lock --no-audit --no-fund "prisma@${version}"

# --- migrate: Prisma CLI + migrations only --------------------------------------------------
FROM base AS migrate
ENV NODE_ENV=production
# The job only runs the Prisma CLI: drop the package managers bundled with the base image (and their CVEs).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=migrate-cli /prisma-cli/node_modules ./node_modules
COPY --from=build /app/certs ./certs
COPY package.json ./
COPY src/prisma ./src/prisma
USER node
ENTRYPOINT ["node_modules/.bin/prisma", "migrate", "deploy"]

# --- runtime ---------------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:6c19627684167feb45e7ab0b4938e01a4922fc4abd9abd430df07606a6ab0e26 AS runtime
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
