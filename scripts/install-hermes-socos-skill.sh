#!/bin/sh
set -eu

umask 077

script_path=$0
link_count=0
while [ -L "$script_path" ]; do
  link_count=$((link_count + 1))
  if [ "$link_count" -gt 40 ]; then
    echo "Too many installer symlinks." >&2
    exit 1
  fi
  link_target=$(readlink "$script_path")
  case "$link_target" in
    /*) script_path=$link_target ;;
    *) script_path=$(dirname -- "$script_path")/$link_target ;;
  esac
done
script_dir=$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
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
if printf '%s' '{}' | node "$source_dir/scripts/reply-contract.mjs" plan \
  >/dev/null 2>&1; then
  echo "Socos planner did not reject an invalid envelope." >&2
  exit 1
fi

case "${1:-}" in
  --dry-run)
    printf 'install_status=dry-run files=2 cli=plan\n'
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

printf 'install_status=installed files=2 cli=plan\n'
