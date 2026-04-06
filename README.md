Noodle Story Bot is a cozy Discord experience where you run a noodle shop, serve NPC orders, unlock new recipes, expand your staff and decor, and experiment with seasonal content as you progress.

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Scripts](#scripts)
- [Configuration](#configuration)
- [Simulation Harness](#simulation-harness)
- [Data Notes](#data-notes)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Resources](#resources)

## Overview

The bot pairs a stateful game simulation with Discord interactions so players can run a noodle stall, tackle quests, collect badges, and trade seasonal ambiance with friends. Orders arrive through an NPC board, cooking outcomes depend on ingredients and upgrades, and social hooks let players tip, bless, and party with each other.

## Features

- NPC order board with rarity tiers, seasonal recipes, and limited-time requests
- Cooking system with roll-based quality, discovery clues, and scroll unlocks
- Quests, daily rewards, collections, and progression through specializations
- Shop upgrades, decor, staff management, and kitchen unlockables
- Social features such as parties, tips, blessings, and leaderboards
- Simulation harness for validating economy and progression before deploying

## Requirements

- Node.js 18 or newer (ESM-only build)
- A Discord application with bot token, guild, and message content intents
- Writable `data/` directory for SQLite persistence (the bot creates WAL/SHM files at runtime)

## Quick Start

1. Install dependencies

   ```bash
   npm install
   ```

2. Create a `.env` file and add your bot token

   ```bash
   cat <<'EOF' > .env
   DISCORD_TOKEN=your_token_here
   EOF
   ```

3. Register slash commands for your development guild

   ```bash
   npm run register:dev
   ```

4. Start the bot locally

   ```bash
   npm run dev
   ```

## Scripts

- `npm run dev` — launch the bot with watcher/npm environment for rapid iteration
- `npm run start` — run the bot once (no watch mode)
- `npm run register:dev` — register slash commands in the dev guild
- `npm run register:prod` — register slash commands for production
- `npm run test` — execute the automated test suite
- `npm run sim` — exercise the simulation harness (see below)

## Command Registration Notes

- Player-facing commands are registered globally.
- Developer tools are exposed in the official guild via `/noodle-dev`.
- Current dev subcommands: `status`, `reset_tutorial`, `wipe_user`, `repair_profile`.
- Default guild registration mode is `dev-overrides`, which keeps `/noodle` global and applies guild-only overrides for dev tooling.

## Configuration

Only `DISCORD_TOKEN` is required for booting the bot; it exits immediately if the value is missing. Optional runtime knobs such as `NODE_ENV=production` control the verbosity of logging and scheduler behavior, and the SQLite database lives under `data/` unless you customize the path in `db/index.js`.

## Simulation Harness

Run the harness to stress-test progression, upgrades, and rewards without sending Discord traffic:

```bash
npm run sim -- --days=30 --players=100 --orders-per-day=8 --seed=1337 --output=sim-output.json
```

See `SIMULATION.md` for every supported flag and how to interpret the generated report.

## Data Notes

- Persistent SQLite data lives under `data/`; WAL/SHM files are transient and can be regenerated.
- Backups are written to `data/backups/` by the scheduled job and can be restored manually if needed.

## Project Structure

- `src/` — Discord access, command handlers, game logic, infra helpers, and job schedulers
- `content/` — JSON bundles for recipes, NPCs, badges, decor, events, and seasonal sets
- `db/` — SQLite interface, schema definition, and helper queries
- `game/` — Domain rules for cooking, quests, rewards, resilience, and story systems
- `jobs/` — Scheduled work such as daily resets, reward reminders, event sync, and backups
- `test/` — Jest suites covering discovery, inventory, NPC modifiers, orders, resilience, social systems, staff, and upgrades
- `sim/` — Simulation harness entrypoint and helpers
- `data/` — Runtime database storage referenced by `db/index.js`

## Testing

```bash
npm run test
```

The suite exercises discovery, inventory flow, NPC modifiers, order boards, resilience, social interactions, staff, and upgrades.

## Resources

- Detailed simulation options: `SIMULATION.md`
- Team workflow guidelines: `GIT_WORKFLOW.md`