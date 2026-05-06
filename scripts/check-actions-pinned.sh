#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
workflows_dir="$repo_root/.github/workflows"

if [[ ! -d "$workflows_dir" ]]; then
  echo "No workflows directory found at .github/workflows"
  exit 0
fi

errors=0

while IFS= read -r file; do
  while IFS= read -r line; do
    uses_raw="${line#*uses:}"
    uses_ref="$(echo "$uses_raw" | sed 's/#.*$//' | xargs)"

    if [[ -z "$uses_ref" ]]; then
      continue
    fi

    if [[ "$uses_ref" == ./* ]]; then
      continue
    fi

    if [[ "$uses_ref" == docker://* ]]; then
      continue
    fi

    if [[ ! "$uses_ref" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-fA-F]{40}$ ]]; then
      echo "Policy check failed in $file"
      echo "  Invalid uses reference: $uses_ref"
      echo "  Expected format: owner/repo@<40-char-commit-sha>"
      errors=1
    fi
  done < <(grep -nE '^[[:space:]]*-?[[:space:]]*uses:[[:space:]]+' "$file" | sed 's/^[0-9]\+://')
done < <(find "$workflows_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

if [[ $errors -ne 0 ]]; then
  echo
  echo "Push blocked: pin all workflow actions to full commit SHAs."
  exit 1
fi

echo "Workflow action pinning check passed."
