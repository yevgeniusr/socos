#!/bin/sh
set -eu

umask 077

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir="$repo_root/integrations/hermes/skills/socos-social-loop"
hermes_home=${HERMES_HOME:-"$HOME/.hermes"}
target_dir="$hermes_home/skills/socos/socos-social-loop"

for file in SKILL.md scripts/reply-contract.mjs; do
  if [ ! -f "$source_dir/$file" ]; then
    echo "Missing tracked Socos skill file: $file" >&2
    exit 1
  fi
done

node --check "$source_dir/scripts/reply-contract.mjs"

case "${1:-}" in
  --dry-run)
    printf 'install_status=dry-run files=2\n'
    exit 0
    ;;
  '')
    ;;
  *)
    echo "Usage: $0 [--dry-run]" >&2
    exit 64
    ;;
esac

mkdir -p "$target_dir/scripts"
chmod 0700 "$target_dir" "$target_dir/scripts"
install -m 0600 "$source_dir/SKILL.md" "$target_dir/SKILL.md"
install -m 0600 \
  "$source_dir/scripts/reply-contract.mjs" \
  "$target_dir/scripts/reply-contract.mjs"

printf 'install_status=installed files=2\n'
