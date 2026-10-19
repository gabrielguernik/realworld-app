#!/usr/bin/env bash
# Runs the RealWorld API spec (Postman collection) against a running API with Newman.
#
#   APIURL=http://localhost:3000/api tests/api/run-api-tests.sh
#
# The collection is vendored from gothinkster/realworld at commit d895173cf7728845dc05c7abe4724518da90f058
# (api/Conduit.postman_collection.json, the version current when this implementation was written;
# later revisions add stricter 2026 spec rules it does not follow). Unique credentials per run, so it can run repeatedly against one database.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APIURL="${APIURL:-http://localhost:3000/api}"
USERNAME="${USERNAME:-u$(date +%s)$RANDOM}"
EMAIL="${EMAIL:-${USERNAME}@mail.com}"
PASSWORD="${PASSWORD:-password}"
DELAY_REQUEST="${DELAY_REQUEST:-}"

# Wait up to 60 s for the API to answer.
for _ in $(seq 1 60); do
  curl -fsS "${APIURL%/api}/healthz" >/dev/null 2>&1 && break
  sleep 1
done

delay=()
[[ -n "${DELAY_REQUEST}" ]] && delay=(--delay-request "${DELAY_REQUEST}")

npx --yes newman@6 run "${DIR}/Conduit.postman_collection.json" \
  "${delay[@]}" \
  --global-var "APIURL=${APIURL}" \
  --global-var "USERNAME=${USERNAME}" \
  --global-var "EMAIL=${EMAIL}" \
  --global-var "PASSWORD=${PASSWORD}" \
  "$@"
