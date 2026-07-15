#!/bin/bash
set -euo pipefail

: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
BASE_URL="${COOLIFY_BASE_URL:-https://qed.quest}"

api() {
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "$@"
}

case "${1:-}" in
  list-apps)
    api "$BASE_URL/api/v1/applications" |
      jq -r '.[] | "\(.uuid) \(.name) \(.status)"'
    ;;
  get-app)
    api "$BASE_URL/api/v1/applications/$2" |
      jq '.status, .fqdn, .ports_exposes'
    ;;
  start)
    api -X POST "$BASE_URL/api/v1/applications/$2/start"
    ;;
  stop)
    api -X POST "$BASE_URL/api/v1/applications/$2/stop"
    ;;
  logs)
    api "$BASE_URL/api/v1/applications/$2/logs" |
      jq -r '.logs[-20:][] | .output'
    ;;
  add-env)
    payload=$(jq -nc --arg key "$3" --arg value "$4" '{key:$key,value:$value}')
    api -X POST "$BASE_URL/api/v1/applications/$2/envs" \
      -H "Content-Type: application/json" \
      --data-binary "$payload"
    ;;
  deploy)
    payload=$(jq -nc --arg uuid "$2" '{uuid:$uuid,force:true}')
    response=$(api -X POST "$BASE_URL/api/v1/deploy" \
      -H "Content-Type: application/json" \
      --data-binary "$payload")
    deployment_uuid=$(jq -er '.deployments[0].deployment_uuid' <<<"$response")

    for _ in $(seq 1 "${COOLIFY_DEPLOY_POLL_ATTEMPTS:-120}"); do
      deployment_status=$(api "$BASE_URL/api/v1/deployments/$deployment_uuid" |
        jq -er '.status')
      case "$deployment_status" in
        finished)
          printf 'deployment_status=finished\n'
          exit 0
          ;;
        failed|cancelled|cancelled-by-user)
          printf 'deployment_status=%s\n' "$deployment_status" >&2
          exit 1
          ;;
      esac
      sleep "${COOLIFY_DEPLOY_POLL_SECONDS:-5}"
    done
    echo "Timed out waiting for Coolify deployment." >&2
    exit 1
    ;;
  *)
    echo "Usage: $0 {list-apps|get-app|start|stop|logs|add-env|deploy} [args]" >&2
    exit 64
    ;;
esac
