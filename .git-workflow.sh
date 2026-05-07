#!/bin/bash
# Git Workflow Helper Script
# Usage: source .git-workflow.sh (to load functions into your shell)

# Quick commit with conventional format
qcommit() {
    if [ -z "$1" ] || [ -z "$2" ]; then
        echo "Usage: qcommit <type> <message>"
        echo "Types: feat, fix, refactor, docs, test, chore, style"
        echo "Example: qcommit feat 'add daily bonus system'"
        return 1
    fi
    git commit -m "$1: $2"
}

# Create a feature branch from latest origin/main
cleanstart() {
    local branch="$1"
    if [ -z "$branch" ]; then
        echo "Usage: cleanstart <branch-name>"
        echo "Example: cleanstart fix/staff-gating"
        return 1
    fi

    echo "Fetching origin/main..."
    git fetch origin main || return 1

    if git show-ref --verify --quiet "refs/heads/$branch"; then
        echo "Branch exists locally, checking out: $branch"
        git checkout "$branch" || return 1
        echo "Rebasing onto origin/main..."
        git rebase origin/main || return 1
    else
        echo "Creating branch from origin/main: $branch"
        git checkout -b "$branch" origin/main || return 1
    fi
}

# Rebase current branch onto latest origin/main
syncmain() {
    local current
    current=$(git branch --show-current)

    if [ "$current" = "main" ]; then
        echo "You're on main. Switch to a feature branch first."
        return 1
    fi

    echo "Fetching origin/main..."
    git fetch origin main || return 1
    echo "Rebasing $current onto origin/main..."
    git rebase origin/main
}

# Quick checks before commit/push
preflight() {
    local current
    current=$(git branch --show-current)

    echo "=== Branch ==="
    echo "$current"
    if [ "$current" = "main" ]; then
        echo "WARNING: You are on main. Prefer feature branches for commits."
    fi

    echo ""
    echo "=== Status ==="
    git status --short

    echo ""
    echo "=== Staged Diff Stat ==="
    git diff --staged --stat

    if [ -n "$(git diff --staged --name-only)" ] && [ -n "$(git diff --name-only)" ]; then
        echo ""
        echo "NOTE: You have both staged and unstaged changes."
        echo "Verify only the intended hunks are staged."
    fi
}

# Show branch readiness relative to origin/main
ready() {
    local current
    current=$(git branch --show-current)
    echo "Fetching origin/main..."
    git fetch origin main || return 1

    echo "=== Ahead/Behind origin/main ==="
    git rev-list --left-right --count origin/main..."$current"

    echo ""
    echo "=== Commit Graph (vs origin/main) ==="
    git log --oneline --graph --decorate origin/main.."$current"
}

# Review what you're about to commit
review() {
    echo "=== Staged Changes ==="
    git diff --staged --stat
    echo ""
    echo "=== Detailed Diff ==="
    git diff --staged
}

# Interactive staging
stage() {
    if [ -z "$1" ]; then
        echo "Launching interactive staging..."
        git add -p
    else
        git add "$@"
    fi
}

# Clean up last N commits (interactive rebase)
cleanup() {
    local n=${1:-3}
    echo "Cleaning up last $n commits..."
    git rebase -i HEAD~$n
}

# Show commit history in a nice format
history() {
    local n=${1:-10}
    git log --oneline --graph --decorate -n $n
}

# Unstage all changes
unstage() {
    git reset HEAD
}

# Amend last commit (add forgotten changes)
amend() {
    if [ "$1" = "msg" ]; then
        git commit --amend
    else
        git commit --amend --no-edit
    fi
}

# Show what would be committed
whatsnew() {
    echo "=== Untracked Files ==="
    git ls-files --others --exclude-standard
    echo ""
    echo "=== Modified Files ==="
    git diff --name-status
    echo ""
    echo "=== Staged Files ==="
    git diff --staged --name-status
}

echo "Git workflow helpers loaded!"
echo "Available commands:"
echo "  qcommit <type> <msg>  - Quick conventional commit"
echo "  cleanstart <branch>   - Start/update branch from origin/main"
echo "  syncmain              - Rebase current branch onto origin/main"
echo "  preflight             - Run quick branch/status safety checks"
echo "  ready                 - Show branch divergence from origin/main"
echo "  review                - Review staged changes"
echo "  stage [files]         - Interactive or specific staging"
echo "  cleanup [n]           - Clean up last n commits (default 3)"
echo "  history [n]           - Show last n commits (default 10)"
echo "  unstage               - Unstage all changes"
echo "  amend [msg]           - Amend last commit (use 'msg' to edit message)"
echo "  whatsnew              - Show all changes (staged/unstaged/untracked)"
