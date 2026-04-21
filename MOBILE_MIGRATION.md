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

## 4) Create Sync Policy In The Mobile Repo

Before extraction work begins, create `SYNC_POLICY.md` in `noodle-story-mobile` and commit it on `mobile-bootstrap`.

Minimum policy content:

- Scope ownership:
   - `noodle-story-bot-final` owns Discord runtime, commands, schedulers, and bot operations.
   - `noodle-story-mobile` owns mobile entrypoints, adapters, and platform-specific integrations.
- Shared-logic handling (`src/game`, `src/util`, `content`):
   - During early migration, use targeted cherry-picks from bot repo fixes.
   - Record each sync in a short changelog section (date, source commit, reason).
- Conflict rule:
   - If behavior diverges for platform reasons, keep implementations separate and document why.
- Cadence:
   - Review cross-repo sync needs at least once per sprint.

## 5) Initial Migration Inventory (Keep/Replace)

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

## 6) Suggested First Mobile Extraction Order

1. Copy baseline into the mobile repo using the tagged commit.
2. Add `SYNC_POLICY.md` and commit it before any major extraction.
3. Keep `src/game/`, `src/util/`, `src/constants.js`, and `content/` intact.
4. Replace Discord entry/command layers with mobile app entry points.
5. Remove or stub Discord scheduler and infra integrations.
6. Add mobile-facing adapters around game state and progression APIs.
