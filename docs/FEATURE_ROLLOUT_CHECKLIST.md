# Feature Rollout Checklist (PebbleHost + Discord)

Use this as the live runbook. Check each box only after verifying it. Settings are documented in [FEATURE_ROLLOUT_ENVIRONMENT.md](./FEATURE_ROLLOUT_ENVIRONMENT.md); copy is in [PLAYER_COPY_REVIEW.md](./PLAYER_COPY_REVIEW.md); the audit trail is in [FEATURE_ROLLOUT_PLAN.md](./FEATURE_ROLLOUT_PLAN.md).

Rules: run **one** bot process only; enable **one** feature at a time; never retry an uncertain post without checking Discord first.

## A. Before deploying

- [ ] `npm run review:all` passes locally and the develop → main PR is reviewed and merged, so PebbleHost runs the reviewed code.
- [ ] Stop the bot, then download `data/noodlestory.sqlite` (plus `-wal`/`-shm` if present) from PebbleHost.
- [ ] Confirm `data/` and `noodle-logs/` will not be overwritten by the upload or `git pull`.
- [ ] Set `NOODLE_BACKUP_DIR` to a path that survives redeploys; plan to copy backups off the host.
- [ ] Restore the downloaded copy **locally** (never over live data): `PRAGMA integrity_check` returns `ok` and a few player rows look right. Note how long it took.
- [ ] All feature flags are `0`/unset: `NOODLE_WORK_PING_ENABLED`, `NOODLE_GIVEAWAYS_ENABLED`, `NOODLE_GAME_UPDATES_ENABLED`, `NOODLE_OFFICIAL_COUNTING_ENABLED`, every `*_PRODUCTION_ENABLED`, and every `*_COPY_APPROVED`.
- [ ] PebbleHost runs Node 20.13 or newer (`package.json` engines); existing `DISCORD_TOKEN`, `NOODLE_OFFICIAL_GUILD_ID` (or `DISCORD_GUILD_ID`), and `NOODLE_DEV_ALERT_CHANNEL_ID` are present.
- [ ] Add only the missing keys from the copy/paste block in [FEATURE_ROLLOUT_ENVIRONMENT.md](./FEATURE_ROLLOUT_ENVIRONMENT.md); edit existing keys rather than duplicating them; keep the blank ID placeholders until needed.
- [ ] `NOODLE_COMPONENTS_V2_ENABLED` is unchanged (it applies to every server).
- [ ] Remove `NOODLE_COMPONENTS_V2_GUILD_ALLOWLIST` and `NOODLE_COMPONENTS_V2_USER_ALLOWLIST` from the PebbleHost `.env`; they are now ignored (they were also removed from `ENVIRONMENT.md` and the V2 cutover checklist).
- [ ] Set `NOODLE_TELEMETRY_MODE=all` and `NOODLE_TELEMETRY_SAMPLE_RATE=1` for the first day (usable baseline).

## B. Deploy

- [ ] Upload code; run `npm ci` only if dependencies changed.
- [ ] No old instance is still running (avoid overlapping processes).
- [ ] Run `npm run register:prod`; confirm `/noodle-dev admin` shows `game_update_preview`, `game_update_schedule`, `delivery_reconcile`, and `giveaway_valor_fulfilled`.
- [ ] Start the bot. Console shows `Logged in as …` with no schema/migration errors and no unexpected "disabled because required configuration is missing" lines.
- [ ] `noodle-logs/telemetry.log` exists and is growing.

## C. Smoke test on Discord (features still off)

- [ ] `/noodle start`, orders board, kitchen, garden, recipes, social Stats all open without errors.
- [ ] Orders board → **Menu**: select recipes across several pages, **Save Menu** commits once; **Cancel Draft** discards; a second change the same UTC day is refused.
- [ ] The Daily Menu picker shows the `scene_banner_menu` banner (Menu.png) and the Save Menu / Cancel Draft buttons.
- [ ] Achievements opens from the Stats button beside Collections; Claim works once and cannot be repeated.
- [ ] Customize Profile → **Badges**: equip/unequip, 7-per-row cap, Back works.
- [ ] Tutorial and tutorial reset work for a test user.
- [ ] `/noodle-dev` works for admins in the official guild only.
- [ ] Shared-order over-contribution shows the private limit message.
- [ ] News shows v0.6.0 as Latest Update; Upcoming lists only Recipe Creation and Noodle A Day.

- [ ] Existing players keep their data: spot-check 2-3 real profiles (coins, recipes, orders) after the restart.

## D. Private canary (one feature at a time)

Prerequisites
- [ ] Canary channel is private (verified by a non-admin account); set `NOODLE_OFFICIAL_FEATURE_CANARY=1`, `NOODLE_DEV_ALERT_CHANNEL_ID`, then `NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED=1`.
- [ ] Copy reviewed (including the Save Menu / Cancel Draft labels and the v0.6.0 update text); set the matching `*_COPY_APPROVED=1`.
- [ ] Canary posts contain **no** role mentions.

Order
1. [ ] Work ping — appears on the even UTC hour; replaces the prior ping; no startup ping.
2. [ ] Game update — `/noodle-dev admin game_update_preview update_id:v0-6-0-first-update` (from `content/game-updates.md`) renders correctly (banner, bullets, length).
3. [ ] Season notice preview renders (dates, bonuses, recipes).
4. [ ] Giveaway preview — shows "Private preview only"; entries/rewards are disabled.
5. [ ] Counting — requires Message Content intent enabled in the Developer Portal, `NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT=1`, bot can read/manage messages in the channel. Valid count, repeat-user, and wrong-number reset behave; reaction emojis display; milestone reward grants once and is confirmed.
6. [ ] Reconciliation rehearsal — resolve a forced `delivery_unknown` with `/noodle-dev admin delivery_reconcile` (delivered needs a message ID; not-delivered needs `verified_absent`).

## E. Production enablement

- [ ] Set `NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID`, `NOODLE_GAME_UPDATES_EVENTS_ROLE_ID`, and the production channel IDs.
- [ ] Set `NOODLE_OFFICIAL_FEATURE_CANARY=0`; restart.
- [ ] **First**: schedule the comprehensive update (`v0-6-0-first-update`) with `/noodle-dev admin game_update_schedule`; confirm it posts once and mentions the roles. Other updates and season notices are held until it is sent.
- [ ] Enable `*_PRODUCTION_ENABLED` for one feature, wait one full job cycle, verify, then the next (work ping → giveaways → counting).
- [ ] Giveaways: configure `NOODLE_GIVEAWAY_CHANNEL_ID` and `NOODLE_GIVEAWAY_VALOR_FULFILLER_ID`; after manually sending a VALOR prize, run `/noodle-dev admin giveaway_valor_fulfilled`.

## F. Monitoring (first 24 hours)

- [ ] Watch console and telemetry; enable reports with `NOODLE_V2_TELEMETRY_REPORTS_ENABLED=1` and a `NOODLE_TELEMETRY_ALERT_CHANNEL_ID` different from the dev alert channel.
- [ ] Record baseline: interaction p50/p95, failure rate, job outcomes, dropped-record warnings (low traffic = inconclusive).
- [ ] 03:00 UTC backup appeared and was copied off the host.
- [ ] Any `delivery_unknown`: check Discord first, then reconcile — never retry blindly.

## G. Rollback

- [ ] Features: set the flag(s) to `0` and restart (stops future posts; granted rewards and posted messages are not undone).
- [ ] Data: stop the bot, restore the pre-deploy backup, redeploy the previous code, restart.
