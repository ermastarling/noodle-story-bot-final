#!/usr/bin/env bash
set -euo pipefail

OWNER="${1:-ermastarling}"
REPO_NAME="${2:-noodle-story-mobile}"
TARGET_DIR="${3:-../noodle-story-mobile}"
BOOTSTRAP_BRANCH="mobile-bootstrap"

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this command must run inside a git repository."
  exit 1
fi

SOURCE_REMOTE_URL="$(git config --get remote.origin.url || true)"
if [[ -z "$SOURCE_REMOTE_URL" ]]; then
  echo "Error: no origin remote configured in current repository."
  exit 1
fi

if [[ -e "$TARGET_DIR" ]]; then
  echo "Error: target directory '$TARGET_DIR' already exists."
  exit 1
fi

echo "Cloning source repository into '$TARGET_DIR'..."
git clone "$SOURCE_REMOTE_URL" "$TARGET_DIR"

cd "$TARGET_DIR"
echo "Creating bootstrap branch '$BOOTSTRAP_BRANCH'..."
git switch -c "$BOOTSTRAP_BRANCH"

FULL_REPO="$OWNER/$REPO_NAME"
echo "Creating private GitHub repository '$FULL_REPO' and pushing bootstrap branch..."
gh repo create "$FULL_REPO" --private --source=. --remote=origin --push

echo ""
echo "Mobile bootstrap complete."
echo "Repository: $FULL_REPO"
echo "Branch: $BOOTSTRAP_BRANCH"
echo "Path: $TARGET_DIR"
echo ""
echo "Next: update the new repository README with baseline tag and commit reference."
