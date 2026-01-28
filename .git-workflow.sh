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
echo "  review                - Review staged changes"
echo "  stage [files]         - Interactive or specific staging"
echo "  cleanup [n]           - Clean up last n commits (default 3)"
echo "  history [n]           - Show last n commits (default 10)"
echo "  unstage               - Unstage all changes"
echo "  amend [msg]           - Amend last commit (use 'msg' to edit message)"
echo "  whatsnew              - Show all changes (staged/unstaged/untracked)"
