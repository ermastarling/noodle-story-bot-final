#!/usr/bin/env bash
set -euo pipefail

TAG_NAME="${1:-mobile-base-v1}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this command must run inside a git repository."
  exit 1
fi

if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
  echo "Error: tag '$TAG_NAME' already exists. Choose a new tag name."
  exit 1
fi

echo "Running test suite before creating baseline tag..."
npm test

CURRENT_SHA="$(git rev-parse HEAD)"
git tag -a "$TAG_NAME" -m "Baseline freeze for mobile migration"

echo ""
echo "Baseline tag created."
echo "Tag: $TAG_NAME"
echo "Commit: $CURRENT_SHA"
echo ""
echo "Next step: push the tag when ready:"
echo "  git push origin $TAG_NAME"
