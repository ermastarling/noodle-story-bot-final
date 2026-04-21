# Mobile Migration Kickoff (Issue #48)

This document starts issue #48 by defining a safe baseline freeze and a reproducible bootstrap path to a dedicated mobile repository, while preserving this Discord bot repository.

## 1) Baseline Freeze In This Repository

Target tag: `mobile-base-v1`

Run:

```bash
npm run mobile:baseline
```

What it does:

- Runs the full bot test suite.
- Creates an annotated tag (`mobile-base-v1` by default) on the current commit if tests pass.
- Prints the tagged commit SHA for reference.

Optional custom tag:

```bash
bash scripts/mobile/cut-mobile-baseline.sh mobile-base-v2
```

## 2) Bootstrap The New Mobile Repository

After the baseline tag exists, run:

```bash
bash scripts/mobile/bootstrap-mobile-repo.sh ermastarling noodle-story-mobile ../noodle-story-mobile
```

This performs the requested flow:

1. Clones this repository into a new folder.
2. Creates and switches to `mobile-bootstrap`.
3. Creates and pushes a private repository:
   `gh repo create ermastarling/noodle-story-mobile --private --source=. --remote=origin --push`

## 3) Required README Note In The Mobile Repo

When the new mobile repository is created, include a baseline reference in that repository README:

- Source baseline tag: `mobile-base-v1`
- Source baseline commit: `<commit-sha from baseline script output>`

## 4) Initial Migration Inventory (Keep/Replace)

Keep/reuse first:

- `src/game/`
- `src/util/`
- `src/constants.js`
- `content/`
- Selected `src/settings/`

Replace/remove first:

- `src/index.js`
- `src/register-commands.js`
- `src/commands/`
- Discord-specific `src/jobs/`
- Discord-specific portions of `src/infra/`

## 5) Suggested First Mobile Extraction Order

1. Copy baseline into the mobile repo using the tagged commit.
2. Keep `src/game/`, `src/util/`, `src/constants.js`, and `content/` intact.
3. Replace Discord entry/command layers with mobile app entry points.
4. Remove or stub Discord scheduler and infra integrations.
5. Add mobile-facing adapters around game state and progression APIs.
