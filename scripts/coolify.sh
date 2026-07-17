#!/bin/bash
set -euo pipefail

: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
BASE_URL="${COOLIFY_BASE_URL:-https://qed.quest}"

case "$BASE_URL" in
  https://*) ;;
  *)
    echo "COOLIFY_BASE_URL must use HTTPS." >&2
    exit 64
    ;;
esac

if [[ "$COOLIFY_TOKEN" == *$'\n'* || "$COOLIFY_TOKEN" == *$'\r'* ]]; then
  echo "COOLIFY_TOKEN is invalid." >&2
  exit 64
fi

api() {
  curl --fail-with-body --silent --show-error \
    --header @/dev/fd/3 \
    "$@" \
    3<<<"Authorization: Bearer $COOLIFY_TOKEN"
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
    echo "add-env is disabled; use scripts/coolify-activate.mjs with one JSON document on stdin." >&2
    exit 64
    ;;
  deploy)
    expected_commit=${COOLIFY_EXPECTED_COMMIT_SHA:-}
    if [ -n "$expected_commit" ] && [[ ! "$expected_commit" =~ ^[0-9a-fA-F]{40}$ ]]; then
      echo "COOLIFY_EXPECTED_COMMIT_SHA must be a full 40-character Git commit SHA." >&2
      exit 64
    fi

    if [ -n "$expected_commit" ]; then
      application_response=$(api "$BASE_URL/api/v1/applications/$2")
      git_branch=$(jq -er '.git_branch' <<<"$application_response")
      if [ "$git_branch" != main ]; then
        echo "Coolify application must deploy the main branch." >&2
        exit 1
      fi
      configured_revision=$(jq -r '.git_commit_sha // empty' <<<"$application_response")
      case "$configured_revision" in
        HEAD|'')
          printf 'deployment_preflight=main source_revision=%s verification=post-deploy\n' \
            "${configured_revision:-unexposed}"
          ;;
        "$expected_commit")
          printf 'deployment_preflight=main source_revision=pinned verification=post-deploy\n'
          ;;
        *)
          echo "Coolify application revision pin does not match required commit." >&2
          exit 1
          ;;
      esac
    fi

    response=$(jq -nc --arg uuid "$2" '{uuid:$uuid,force:true}' |
      api -X POST "$BASE_URL/api/v1/deploy" \
        -H "Content-Type: application/json" \
        --data-binary @-)
    deployment_uuid=$(jq -er '.deployments[0].deployment_uuid' <<<"$response")
    printf 'deployment_uuid=%s\n' "$deployment_uuid"

    for _ in $(seq 1 "${COOLIFY_DEPLOY_POLL_ATTEMPTS:-120}"); do
      deployment_response=$(api "$BASE_URL/api/v1/deployments/$deployment_uuid")
      deployment_status=$(jq -er '.status' <<<"$deployment_response")
      case "$deployment_status" in
        finished)
          deployment_commit=$(jq -er \
            '.commit | select(type == "string" and test("^[0-9a-fA-F]{40}$"))' \
            <<<"$deployment_response")
          if [ -n "$expected_commit" ] && [ "$deployment_commit" != "$expected_commit" ]; then
            echo "Deployed commit does not match required commit." >&2
            exit 1
          fi
          printf 'deployment_status=finished\n'
          printf 'deployment_commit=%s\n' "$deployment_commit"
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
    echo "Usage: $0 {list-apps|get-app|start|stop|logs|deploy} [args]" >&2
    exit 64
    ;;
esac
