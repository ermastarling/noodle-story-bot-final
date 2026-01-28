# Git Workflow Guide

## Quick Start

Load the workflow helpers in your terminal:
```bash
source .git-workflow.sh
```

## Daily Workflow

### 1. **Make Changes & Review**
```bash
whatsnew              # See all changes
git status            # Quick status
```

### 2. **Stage Changes Selectively**
```bash
stage                 # Interactive staging (review each change)
stage src/file.js     # Stage specific file
git add -p            # Alternative interactive staging
```

### 3. **Review Before Committing**
```bash
review                # See exactly what you're committing
git staged            # Alias: review staged changes
```

### 4. **Commit with Clear Message**
```bash
git commit            # Opens template with guidance
qcommit feat "add daily bonus system"
qcommit fix "prevent negative noodle counts"
```

### 5. **Fix Mistakes**
```bash
amend                 # Add forgotten changes to last commit
amend msg             # Edit last commit message
git unstage           # Unstage everything
```

## Pre-Push Cleanup

### View Your Commits
```bash
history 5             # See last 5 commits
git history -10       # Alias works too
```

### Clean Up Commits Before Pushing
```bash
cleanup 3             # Interactive rebase of last 3 commits
git cleanup HEAD~5    # Clean up last 5 commits
git squash 3          # Squash last 3 commits into one
```

**How to squash commits:**
```bash
git squash 2          # Opens editor to squash last 2 commits
git squash 5          # Squash last 5 commits
```

In the interactive rebase editor:
- `pick` = keep commit as-is
- `reword` = change commit message
- `squash` = combine with previous commit (keeps both messages)
- `fixup` = combine with previous commit (discards this message)
- `drop` = delete commit

**Pro tip:** Change `pick` to `squash` (or `s`) for commits you want to combine

## Git Aliases Available

- `git staged` - Review staged changes
- `git unstage` - Unstage all changes  
- `git amend` - Add to last commit (no message change)
- `git amendedit` - Add to last commit and edit message
- `git history` - Pretty commit history
- `git cleanup` - Interactive rebase shortcut
- `git squash <n>` - Squash last n commits (default: 2)

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `refactor` - Code restructuring
- `docs` - Documentation only
- `test` - Adding/updating tests
- `chore` - Maintenance tasks
- `style` - Formatting/whitespace

**Examples:**
```
feat: add daily login bonus system

fix(noodle): prevent negative noodle counts on failed orders

refactor(database): optimize player stats queries

docs: update README with deployment instructions

test(social): add tests for friend request system
```

## Best Practices

✅ **DO:**
- Commit each logical change separately
- Write descriptive messages explaining "why"
- Review staged changes before committing
- Clean up commits before pushing
- Use conventional commit format

❌ **DON'T:**
- Commit unrelated changes together
- Use vague messages like "updates" or "fixes"
- Commit broken/untested code
- Include commented-out code or debug logs
- Push messy commit history

## Quick Reference

```bash
# Typical workflow
whatsnew                          # What changed?
stage                             # Stage interactively
review                            # Review staged changes
qcommit feat "add bonus system"   # Quick commit
history                           # Check history
git squash 3                      # Squash last 3 commits
git push                          # Push clean commits

# Common squashing scenarios
git squash 2                      # Combine last 2 commits
git history                       # Verify the result
```
