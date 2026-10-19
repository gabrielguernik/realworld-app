# ![Node/Express/Prisma Example App](project-logo.png)

[![ci](https://github.com/gabrielguernik/realworld-app/actions/workflows/ci.yml/badge.svg)](https://github.com/gabrielguernik/realworld-app/actions/workflows/ci.yml)

> ### Example Node (Express + Prisma) codebase containing real world examples (CRUD, auth, advanced patterns, etc) that adheres to the [RealWorld](https://github.com/gothinkster/realworld-example-apps) API spec.

<a href="https://thinkster.io/tutorials/node-json-api" target="_blank"><img width="454" src="https://raw.githubusercontent.com/gothinkster/realworld/master/media/learn-btn-hr.png" /></a>


> **This fork** is the API for the Incode DevOps take-home: the RealWorld backend from
> [gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app)
> (MIT, per its `package.json`), made production-ready to run on EKS. The infrastructure lives in
> `gabrielguernik/infra`. Changes from upstream are summarized below; the original README follows.

## What this fork adds

| Area | Change |
|---|---|
| Config | All settings from the environment (`src/app/config.ts`). With `NODE_ENV=production`, a missing `JWT_SECRET` or `DATABASE_URL` stops the process at startup instead of falling back to a default. |
| Health | `GET /healthz` (liveness, no dependencies) and `GET /readyz` (PostgreSQL must answer; the cache is reported but never fails readiness). |
| Metrics | `GET /metrics` (Prometheus): `http_request_duration_seconds` by route template, `cache_requests_total`, process metrics and Prisma pool/query metrics. |
| Logs | JSON on stdout (pino). Every request gets an ID (incoming `X-Request-Id` or a UUID), returned in the response and present on every log line as `reqId`. The `Authorization` header is redacted. |
| Cache | Valkey/Redis read-through cache for `GET /api/tags` (60 s) and `GET /api/articles/:slug` (30 s). Writes invalidate through a generation counter. Fails open: with the cache down, requests are served from PostgreSQL. Cached read models hold user IDs only, never user rows. |
| Shutdown | SIGTERM stops accepting connections, drains in-flight requests, then closes the DB pool and cache. |
| Container | Multi-stage `Dockerfile`: `runtime` target on distroless Node.js 22 (non-root, read-only root filesystem) and a `migrate` target that runs `prisma migrate deploy`. The RDS CA bundle is baked in for verified TLS to the database. |
| Fixes | Tag lists are returned alphabetically (stable order, as the spec expects). A unit-test import-order bug that bypassed the Prisma mock is fixed. Vulnerable dependencies are upgraded (express 4.22, jsonwebtoken 9.0.3); axios is now dev-only. |
| CI | `.github/workflows/ci.yml`: lint, unit tests, hadolint, the RealWorld API spec (Newman) against docker compose, a Trivy scan, and on `main` a push to ECR through GitHub OIDC (no AWS keys) with a CycloneDX SBOM. |

## Configuration

| Variable | Required | Example / notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://USER:PASSWORD@HOST:5432/realworld?sslmode=require&sslcert=/app/certs/rds-global-bundle.pem&sslaccept=strict&connection_limit=5` (RDS: TLS verified against the bundled CA) |
| `JWT_SECRET` | yes | Long random string |
| `REDIS_URL` | no | `rediss://:AUTH_TOKEN@HOST:6379` (TLS); unset disables the cache |
| `PORT` | no | `3000` |
| `LOG_LEVEL` | no | `info` |

## Run it locally

```bash
docker compose up --build -d          # postgres 18, valkey 8.1, migrations, the API on :3000
curl localhost:3000/readyz            # {"status":"ok","database":"ok","cache":"ok"}
tests/api/run-api-tests.sh            # RealWorld API spec (Newman)
docker compose down -v
```

Unit tests and lint: `npm ci && npx prisma generate && npx nx test api && npx nx lint api`.

---

## Getting Started

### Prerequisites

Run the following command to install dependencies:

```shell
npm install
```

### Environment variables

This project depends on some environment variables.
If you are running this project locally, create a `.env` file at the root for these variables.
Your host provider should included a feature to set them there directly to avoid exposing them.

Here are the required ones:

```
DATABASE_URL=
JWT_SECRET=
NODE_ENV=production
```

### Generate your Prisma client

Run the following command to generate the Prisma Client which will include types based on your database schema:

```shell
npx prisma generate
```

### Apply any SQL migration script

Run the following command to create/update your database based on existing sql migration scripts:

```shell
npx prisma migrate deploy
```

### Run the project

Run the following command to run the project:

```shell
npx nx serve api
```

### Seed the database

The project includes a seed script to populate the database:

```shell
npx prisma db seed
```

## Deploy on a remote server

Run the following command to:
- install dependencies
- apply any new migration sql scripts
- run the server

```shell
npm ci && npx prisma migrate deploy && node dist/api/main.js
```
