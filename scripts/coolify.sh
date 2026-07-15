#!/bin/bash
# Coolify Management CLI for SOCOS

set -eu

: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
BASE_URL="${COOLIFY_BASE_URL:-https://qed.quest}"

case "$1" in
  list-apps)
    curl -s "$BASE_URL/api/v1/applications" -H "Authorization: Bearer $COOLIFY_TOKEN" | jq -r '.[] | "\(.uuid) \(.name) \(.status)"'
    ;;
  get-app)
    curl -s "$BASE_URL/api/v1/applications/$2" -H "Authorization: Bearer $COOLIFY_TOKEN" | jq '.status, .fqdn, .ports_exposes'
    ;;
  start)
    curl -s -X POST "$BASE_URL/api/v1/applications/$2/start" -H "Authorization: Bearer $COOLIFY_TOKEN"
    ;;
  stop)
    curl -s -X POST "$BASE_URL/api/v1/applications/$2/stop" -H "Authorization: Bearer $COOLIFY_TOKEN"
    ;;
  logs)
    curl -s "$BASE_URL/api/v1/applications/$2/logs" -H "Authorization: Bearer $COOLIFY_TOKEN" | jq -r '.logs[-20:][] | .output'
    ;;
  add-env)
    curl -s -X POST "$BASE_URL/api/v1/applications/$2/envs" \
      -H "Authorization: Bearer $COOLIFY_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\": \"$3\", \"value\": \"$4\"}"
    ;;
  deploy)
    curl -s -X POST "$BASE_URL/api/v1/applications/$2/start" -H "Authorization: Bearer $COOLIFY_TOKEN"
    ;;
  *)
    echo "Usage: $0 {list-apps|get-app|start|stop|logs|add-env|deploy} [args]"
    ;;
esac
