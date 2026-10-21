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
| Container | Multi-stage `Dockerfile`: `runtime` target on distroless Node.js 22 (non-root, read-only root filesystem) and a `migrate` target that runs `prisma migrate deploy`. The RDS root CA (us-east-1, RSA2048 G1) is baked in for verified TLS to the database. |
| Fixes | Tag lists are returned alphabetically (stable order, as the spec expects). A unit-test import-order bug that bypassed the Prisma mock is fixed. Vulnerable dependencies are upgraded (express 4.22, jsonwebtoken 9.0.3); axios is now dev-only. |
| CI | `.github/workflows/ci.yml`: lint, unit tests, hadolint, Helm chart lint, the RealWorld API spec (Newman) against docker compose, a Trivy scan, and on `main` a push to ECR through GitHub OIDC (no AWS keys) with a CycloneDX SBOM, then a deploy to the sandbox through the gitops repo. |
| Deploy | Helm chart in `deploy/chart`, deployed by ArgoCD from this repo at the same commit as the image (see [Deployment](#deployment)). |

## Configuration

| Variable | Required | Example / notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://USER:PASSWORD@HOST:5432/realworld?sslmode=require&sslcert=/app/certs/rds-ca.pem&sslaccept=strict&connection_limit=5` (RDS: TLS verified against the bundled CA) |
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

## Deployment

The chart in `deploy/chart` is deployed by ArgoCD. Each cluster's settings live in the
[gitops](https://github.com/gabrielguernik/gitops) repo, in `clusters/<cluster>/apps/config/realworld.yaml`. That
file's `revision` is a commit of this repo, and it selects both the chart (`deploy/chart` at that commit) and the
images (`realworld-api:<revision>`, `realworld-api:migrate-<revision>`). Code, migrations, images and chart therefore
always come from one commit, and a rollback is a revert of one line in gitops.

**Flow on merge to `main`:** CI publishes both images, then the `deploy-sandbox` job sets `revision` to the new
commit in the sandbox config and pushes to gitops. The deploy key it uses can only write to gitops and lives in the
`sandbox` GitHub environment, which only `main` can use. ArgoCD then:

1. syncs the two ExternalSecrets, which build `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET` from AWS Secrets Manager
   through this namespace's own IAM role (it can't read anything else);
2. runs the `realworld-migrate` Job (`prisma migrate deploy` as the PostgreSQL role `realworld_migrator`). If it
   fails, the sync stops and the running pods are untouched;
3. rolls the Deployment (pods connect as `realworld_app`, which has data access only: no DDL). The ALB health
   check (`/readyz`) and pod readiness gates keep old pods serving until new ones receive traffic.

**Rules for migrations:** the previous release keeps running while a migration applies, so every migration must work
with the code before it (expand/contract). Add a column, deploy code that writes it, backfill, and only drop or
rename the old column in a later release. Migrations run as `realworld_migrator`, which owns the schema; the
platform's `db-bootstrap` grants `realworld_app` access to new tables automatically.

**Rollback:** revert the deploy commit in gitops (`git revert <sha>` of "realworld: deploy ..."). ArgoCD returns the
chart and the images to the previous commit. Migrations are not reverted: they are forward-only, which is why they
must stay compatible with the previous release.

**Monitoring:** the pods carry `prometheus.io/*` annotations, so the platform's Grafana Alloy scrapes `/metrics` into
Amazon Managed Prometheus (setting `metrics.scrape`). The chart ships no dashboards or alerts: the dashboards are in
gitops (`charts/grafana-dashboards`) and the alert rules in infra (`modules/prometheus-alerts`). Both use the metric
names in `src/app/metrics.ts`, so renaming a metric or a label means updating them in the same change.

**Chart values** that differ per cluster (image repository, sizing, secret names, hostname, ALB security group,
access-log bucket) are set in the gitops config file; `deploy/ci-values.yaml` is a sample used by CI to lint the chart.

---

## Getting Started (upstream, without containers)

> These sections are from the upstream project: running the API directly on your machine with a `.env` file.
> For this fork, prefer "Run it locally" (docker compose) above; deployments go through CI and ArgoCD ("Deployment").

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
