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
- `npm run mobile:baseline` — run tests and create a baseline migration tag (`mobile-base-v1` by default)
- `npm run mobile:bootstrap` — clone and bootstrap a dedicated mobile repository with `gh`
- `npm run review:guard` — run local pre-review safety checks (env-doc drift, new stream-safety patterns, script memory-risk patterns)
- `npm run review:all` — run lint + tests + pre-review guard
- `npm run check:pr-checklist` — validate the active PR body against required checklist rules

## Git Hooks

Enable repo hooks once per clone/codespace:

```bash
npm run setup:hooks
```

The pre-push hook automatically runs:

- `scripts/check-actions-pinned.sh`
- `npm run review:all`
- PR checklist validation (for branches with an existing PR)

For a brand-new branch publish (no PR yet), the first push is allowed and the hook prints a reminder to create the PR with the required checklist completed before subsequent pushes.

## Command Registration Notes

- Player-facing commands are registered globally.
- Developer tools are exposed in the official guild via `/noodle-dev`.
- Current dev subcommands: `status`, `dashboard`, `reset_tutorial`, `wipe_user`, `repair_profile`.
- `/noodle-dev dashboard` now paginates the bot server list and includes Prev/Next navigation to stay within Discord embed limits.
- Default guild registration mode is `dev-overrides`, which keeps `/noodle` global and applies guild-only overrides for dev tooling.

## Configuration

Only `DISCORD_TOKEN` is required for booting the bot; it exits immediately if the value is missing. Optional runtime knobs such as `NODE_ENV=production` control the verbosity of logging and scheduler behavior, and the SQLite database lives under `data/` unless you customize the path in `db/index.js`.

Optional developer alert env vars:

- `NOODLE_OFFICIAL_GUILD_ID` (falls back to `DISCORD_GUILD_ID`) — guild where alerts are sent
- `NOODLE_DEV_ALERT_CHANNEL_ID` — channel ID in the official guild for alerts
- `NOODLE_DEV_ALERT_USER_ID` — user ID that is required for alert mention/ping behavior

Telemetry env vars:

- `NOODLE_TELEMETRY_LOG_DISABLED` — set `1` to disable file telemetry entirely
- `NOODLE_TELEMETRY_LOG_PATH` — optional custom path for telemetry JSONL output
- `NOODLE_TELEMETRY_MODE` — `all` (default), `slow` (only `interaction_slow_event` + `rate_limited`), or `off`
- `NOODLE_TELEMETRY_SAMPLE_RATE` — `0..1` sampling rate for high-volume events (`interaction_latency`, `component_nav_phase`, `component_nav_subroute_phase`)
- `NOODLE_TELEMETRY_MAX_BUFFER_BYTES` — max write buffer guard (default `262144`); events are dropped under sustained backpressure to protect process memory

Official stats counter env vars:

- `NOODLE_OFFICIAL_STATS_CHANNELS_ENABLED` — set `0` to disable official stats counter updates
- `NOODLE_OFFICIAL_STATS_CHANNEL_REFRESH_INTERVAL_MS` — optional refresh interval in ms for scheduled counter updates (minimum enforced to 60,000)
- `NOODLE_OFFICIAL_SERVER_COUNT_CHANNEL_ID`, `NOODLE_OFFICIAL_SHOP_COUNT_CHANNEL_ID`, `NOODLE_OFFICIAL_MEMBER_COUNT_CHANNEL_ID` — explicit voice channel IDs for the official counters; set each one for the specific counter you want to enable
- `NOODLE_OFFICIAL_SERVER_COUNT_LABEL`, `NOODLE_OFFICIAL_SHOP_COUNT_LABEL`, `NOODLE_OFFICIAL_MEMBER_COUNT_LABEL` — optional display labels used when renaming the corresponding configured channels
- `NOODLE_OFFICIAL_STATS_CATEGORY_ID` — optional category ID; configured channels are moved here when set
- PebbleHost note: set these values in your PebbleHost server files environment configuration so they load at runtime

Store/webhook-related env vars:

- `NOODLE_WEBHOOK_PORT` — enables the webhook HTTP server when set
- `NOODLE_WEBHOOK_PATH` — Discord entitlement webhook path (default `/discord/entitlements`)
- `NOODLE_WEBHOOK_LOG_FILE` — optional webhook log file path (default `webhooks.log` in the current working directory)
- `NOODLE_WEBHOOK_LOG_TO_CONSOLE` — set `1` to mirror webhook `error` logs to console in addition to file output
- `NOODLE_TOPGG_WEBHOOK_PATH` + `NOODLE_TOPGG_WEBHOOK_AUTH` (fallback: `TOPGG_WEBHOOK_AUTH`) — Top.gg vote webhook path/auth
- `NOODLE_TOPGG_REQUIRE_SIGNATURE` — set `1` to require valid `x-topgg-signature` and disable token fallback for Top.gg webhooks
- `NOODLE_DISCORDBOTLIST_WEBHOOK_PATH` + `NOODLE_DISCORDBOTLIST_WEBHOOK_AUTH` — Discord Bot List vote webhook
- `NOODLE_VOIDBOTS_WEBHOOK_PATH` + `NOODLE_VOIDBOTS_WEBHOOK_AUTH` — Void Bots vote webhook
- `NOODLE_DISCORDS_WEBHOOK_PATH` + `NOODLE_DISCORDS_WEBHOOK_AUTH` — Discords.com vote webhook
- `NOODLE_BOTLISTME_WEBHOOK_PATH` + `NOODLE_BOTLISTME_WEBHOOK_AUTH` — BotList.me vote webhook
- `NOODLE_STELLARBOTLIST_WEBHOOK_PATH` + `NOODLE_STELLARBOTLIST_WEBHOOK_AUTH` — Stellar Bot List vote webhook
- `NOODLE_DISCORDLISTGG_WEBHOOK_PATH` + `NOODLE_DISCORDLISTGG_WEBHOOK_AUTH` — DiscordList.gg vote webhook
- `NOODLE_RADARCPDV_WEBHOOK_PATH` + `NOODLE_RADARCPDV_WEBHOOK_AUTH` — Radar.CPDV vote webhook
- `NOODLE_TOPGG_TOKEN` (fallbacks: `TOPGG_TOKEN`, `TOPGG_API_TOKEN`) + `NOODLE_TOPGG_STATS_URL` — Top.gg server count sync target (`NOODLE_TOPGG_STATS_URL` optional; default built in)
- `NOODLE_DISCORDBOTLIST_TOKEN` + `NOODLE_DISCORDBOTLIST_STATS_URL` — Discord Bot List stats sync target (`NOODLE_DISCORDBOTLIST_STATS_URL` optional; default built in). Sends `guilds`, `users`, and optional `voice_connections`.
- `NOODLE_DISCORDBOTLIST_VOICE_CONNECTIONS` — optional static voice connection count value for Discord Bot List stats payloads
- `NOODLE_BOTLIST_STATS_SYNC_INTERVAL_MS` — optional periodic stats heartbeat interval (default `900000` ms / 15 min)
- `NOODLE_BOTLIST_STATS_MIN_INTERVAL_MS` — optional minimum gap between stats POSTs per provider across ready/guild events/heartbeat (default `180000` ms / 3 min)
- `NOODLE_VOTE_DUPLICATE_WINDOW_MODE` — optional duplicate suppression mode for vote retries: `sliding` (default) extends the 5-minute window on repeated retries; `fixed` keeps a fixed window from first seen webhook
- `NOODLE_DISCORDBOTLIST_SYNC_COMMANDS` — set `0` to disable Discord Bot List command-list sync (default enabled)
- `NOODLE_DISCORDBOTLIST_COMMANDS_URL` — optional command-list endpoint override (default `https://discordbotlist.com/api/v1/bots/{botId}/commands`)
- `NOODLE_DISCORDBOTLIST_INCLUDE_DEV_COMMANDS` — set `1` to include `noodle-dev` in Discord Bot List command list (default excluded)
- `NOODLE_DISCORDBOTLIST_COMMANDS_WRAP` — set `1` to send command sync payload as `{ commands: [...] }` instead of a bare array
- `NOODLE_VOIDBOTS_TOKEN` + `NOODLE_VOIDBOTS_STATS_URL` — Void Bots server count sync target
- `NOODLE_DISCORDS_TOKEN` + `NOODLE_DISCORDS_STATS_URL` — Discords.com server count sync target
- `NOODLE_BOTLISTME_TOKEN` + `NOODLE_BOTLISTME_STATS_URL` — BotList.me server count sync target
- `NOODLE_DISCORDBOTSGG_TOKEN` + `NOODLE_DISCORDBOTSGG_STATS_URL` — Discord.Bots.gg server count sync target using `guildCount` payload format (no vote rewards; `NOODLE_DISCORDBOTSGG_STATS_URL` optional; default built in)
- `NOODLE_STELLARBOTLIST_TOKEN` + `NOODLE_STELLARBOTLIST_STATS_URL` — Stellar Bot List server count sync target
- `NOODLE_DISCORDLISTGG_TOKEN` + `NOODLE_DISCORDLISTGG_STATS_URL` — DiscordList.gg server count sync target
- `NOODLE_RADARCPDV_TOKEN` + `NOODLE_RADARCPDV_STATS_URL` — Radar.CPDV server count sync target
- `NOODLE_RADARCPDV_SYNC_COMMANDS` — set `0` to disable Radar.CPDV command-list sync (default enabled)
- `NOODLE_RADARCPDV_COMMANDS_URL` — optional Radar.CPDV command-list endpoint override (default `https://api.radarcord.net/bot/{botId}/commands`)
- `NOODLE_RADARCPDV_INCLUDE_DEV_COMMANDS` — set `1` to include `noodle-dev` in Radar.CPDV command list (default excluded)
- `NOODLE_RADARCPDV_COMMANDS_WRAP` — set `1` to send command sync payload as `{ commands: [...] }` instead of a bare array
- `NOODLE_DISCORDEXTREMELIST_TOKEN` + `NOODLE_DISCORDEXTREMELIST_STATS_URL` — Discord Extreme List server count sync target using `serverCount`/`guildCount` payload format
- `NOODLE_BOT_ID` — optional shared bot id for endpoints that include `{botId}` in their URL template (defaults to live client id, then legacy `TOPGG_BOT_ID`, then `1460058511802105976`)
- `TOPGG_BOT_ID` — legacy fallback for `NOODLE_BOT_ID` compatibility
- `DISCORD_PUBLIC_KEY` — required to verify Discord entitlement signatures
- `NOODLE_STRIPE_WEBHOOK_PATH` — Stripe webhook path (default `/store/stripe`)
- `NOODLE_STRIPE_WEBHOOK_SECRET` — Stripe signing secret for webhook validation
- `NOODLE_STRIPE_PRECHECK_PATH` and `NOODLE_STRIPE_PRECHECK_SECRET` — optional store precheck endpoint

PebbleHost `.env` copy/paste template for all vote webhooks + bot-list stats:

```dotenv
# Shared webhook server
NOODLE_WEBHOOK_PORT=3000
# Optional: periodic bot-list stats heartbeat interval (default 15 min)
# NOODLE_BOTLIST_STATS_SYNC_INTERVAL_MS=900000
# Optional: vote duplicate suppression mode (`sliding` default, or `fixed`)
# NOODLE_VOTE_DUPLICATE_WINDOW_MODE=sliding

# Top.gg 
NOODLE_TOPGG_WEBHOOK_PATH=/topgg/webhook
NOODLE_TOPGG_WEBHOOK_AUTH=replace_with_topgg_webhook_auth
# Optional: enforce signature-only auth (disable token fallback)
# NOODLE_TOPGG_REQUIRE_SIGNATURE=0
NOODLE_TOPGG_TOKEN=replace_with_topgg_api_token
# Optional override (default is built in)
# NOODLE_TOPGG_STATS_URL=https://top.gg/api/bots/{botId}/stats

# Discord Bot List
NOODLE_DISCORDBOTLIST_WEBHOOK_PATH=/discordbotlist/webhook
NOODLE_DISCORDBOTLIST_WEBHOOK_AUTH=replace_with_discordbotlist_webhook_auth
NOODLE_DISCORDBOTLIST_TOKEN=replace_with_discordbotlist_api_token
# Optional override (default is built in)
# NOODLE_DISCORDBOTLIST_STATS_URL=https://discordbotlist.com/api/v1/bots/{botId}/stats
# Optional: include voice connections in stats payload
# NOODLE_DISCORDBOTLIST_VOICE_CONNECTIONS=0
# Optional: command-list sync controls
# NOODLE_DISCORDBOTLIST_SYNC_COMMANDS=1
# NOODLE_DISCORDBOTLIST_COMMANDS_URL=https://discordbotlist.com/api/v1/bots/{botId}/commands
# NOODLE_DISCORDBOTLIST_INCLUDE_DEV_COMMANDS=0
# NOODLE_DISCORDBOTLIST_COMMANDS_WRAP=0

# Radarcord
NOODLE_RADARCPDV_WEBHOOK_PATH=/radarcpdv/webhook
NOODLE_RADARCPDV_WEBHOOK_AUTH=replace_with_radarcpdv_webhook_auth
NOODLE_RADARCPDV_TOKEN=replace_with_radarcpdv_api_token
NOODLE_RADARCPDV_STATS_URL=https://api.radarcord.net/bot/{botId}/stats
# Optional: command-list sync controls
# NOODLE_RADARCPDV_SYNC_COMMANDS=1
# NOODLE_RADARCPDV_COMMANDS_URL=https://api.radarcord.net/bot/{botId}/commands
# NOODLE_RADARCPDV_INCLUDE_DEV_COMMANDS=0
# NOODLE_RADARCPDV_COMMANDS_WRAP=0

# DiscordList.gg
NOODLE_DISCORDLISTGG_WEBHOOK_PATH=/discordlistgg/webhook
NOODLE_DISCORDLISTGG_WEBHOOK_AUTH=replace_with_discordlistgg_webhook_auth
NOODLE_DISCORDLISTGG_TOKEN=replace_with_discordlistgg_api_token
NOODLE_DISCORDLISTGG_STATS_URL=https://api.discordlist.gg/v0/bots/{botId}/stats

# Void Bots
NOODLE_VOIDBOTS_WEBHOOK_PATH=/voidbots/webhook
NOODLE_VOIDBOTS_WEBHOOK_AUTH=replace_with_voidbots_webhook_auth
NOODLE_VOIDBOTS_TOKEN=replace_with_voidbots_api_token
NOODLE_VOIDBOTS_STATS_URL=https://api.voidbots.net/bot/stats/{botId}

# Discords.com
NOODLE_DISCORDS_WEBHOOK_PATH=/discords/webhook
NOODLE_DISCORDS_WEBHOOK_AUTH=replace_with_discords_webhook_auth
NOODLE_DISCORDS_TOKEN=replace_with_discords_api_token
NOODLE_DISCORDS_STATS_URL=https://discords.com/bots/api/bot/{botId}/setservers

# Stellar Bot List
NOODLE_STELLARBOTLIST_WEBHOOK_PATH=/stellarbotlist/webhook
NOODLE_STELLARBOTLIST_WEBHOOK_AUTH=replace_with_stellarbotlist_webhook_auth
NOODLE_STELLARBOTLIST_TOKEN=replace_with_stellarbotlist_api_token
# No server-count stats URL is configured for this provider.

# Discord.Bots.gg (server count only; no vote rewards)
NOODLE_DISCORDBOTSGG_TOKEN=replace_with_discordbotsgg_api_token
# Optional override (default is built in)
# NOODLE_DISCORDBOTSGG_STATS_URL=https://discord.bots.gg/api/v1/bots/{botId}/stats

# Discord Extreme List (server count only; no vote webhook support)
NOODLE_DISCORDEXTREMELIST_TOKEN=replace_with_discordextremelist_api_token
NOODLE_DISCORDEXTREMELIST_STATS_URL=replace_with_discordextremelist_stats_endpoint

# BotList.me
NOODLE_BOTLISTME_WEBHOOK_PATH=/botlistme/webhook
NOODLE_BOTLISTME_WEBHOOK_AUTH=replace_with_botlistme_webhook_auth
NOODLE_BOTLISTME_TOKEN=replace_with_botlistme_api_token
NOODLE_BOTLISTME_STATS_URL=https://api.botlist.me/api/v1/bots/{botId}/stats

# Shared bot id template replacement for URLs that use {botId}
NOODLE_BOT_ID=1460058511802105976
# Legacy fallback (optional)
# TOPGG_BOT_ID=1460058511802105976
```

Alert behavior:

- Guild join alerts, Discord entitlement purchase alerts, and Stripe purchase alerts all use a single formatting path.
- Alerts require `NOODLE_DEV_ALERT_USER_ID` when mention is required.
- Guild join/leave alerts include current server count in the embed footer.
- Guild join/leave events also POST updated stats (guild and user counts when supported) to each configured bot list endpoint.
- Purchase alerts include specialization purchase count in the embed footer (all-time from durable purchase history).

## Simulation Harness

Run the harness to stress-test progression, upgrades, and rewards without sending Discord traffic:

```bash
npm run sim -- --days=30 --players=100 --orders-per-day=8 --seed=1337 --output=sim-output.json
```

See `docs/SIMULATION.md` for every supported flag and how to interpret the generated report.

## Data Notes

- Persistent SQLite data lives under `data/`; WAL/SHM files are transient and can be regenerated.
- Backups are written to `data/backups/` by the scheduled job and can be restored manually if needed.
- Durable store purchase history is stored in `store_purchase_events` and is used for all-time specialization purchase counts in dev purchase alerts.

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

- Detailed simulation options: `docs/SIMULATION.md`
- Team workflow guidelines: `docs/GIT_WORKFLOW.md`
- Mobile migration kickoff: `docs/MOBILE_MIGRATION.md`