# Environment Configuration

This document centralizes runtime environment variables for Noodle Story Bot.

Only `DISCORD_TOKEN` is required for booting the bot; it exits immediately if the value is missing. Optional runtime knobs such as `NODE_ENV=production` control the verbosity of logging and scheduler behavior, and the SQLite database lives under `data/` unless you customize the path in `db/index.js`.

## Logging Defaults

Runtime logs now default to the `noodle-logs/` directory:

- `noodle-logs/command-errors.log`
- `noodle-logs/boot-ok.log`
- `noodle-logs/webhooks.log`
- `noodle-logs/user-error-logs/`
- `noodle-logs/telemetry.log`

For variables that accept file paths, absolute paths are honored, and relative paths are resolved under `noodle-logs/`.

## Optional Developer Alert Env Vars

- `NOODLE_DEV_GUILD_ID` (falls back to `DISCORD_GUILD_ID`) - guild where `/noodle-dev` is registered and allowed
- `NOODLE_SKIP_DB` - set `1` to skip opening the SQLite database (state stays in memory); used by tests and command registration, never set in production
- `NOODLE_COMPONENTS_V2_ENABLED` - set `1` to enable Components V2 menus for every server and player (global kill switch; never scoped to the official/dev guild)
- `NOODLE_COMPONENTS_V2_TUTORIAL_ENABLED` - set `0` to keep tutorial-active users on V1; default allows tutorial users onto V2 paths unless explicitly disabled
- `NOODLE_COMPONENTS_V2_TUTORIAL_USER_ALLOWLIST` - optional comma-separated tutorial-active user IDs allowed onto V2 while tutorial gate is off
- `NOODLE_COMPONENTS_V2_MENU_ACCENT_COLOR` - optional menu accent color used in V2 container messages; accepts decimal (`14858347`) or hex (`#E2B86B`), defaults to theme primary
- `NOODLE_COMPONENTS_V2_MENU_DIVIDER_TEXT` - optional divider text for V2 menu guide blocks (legacy alias: `NOODLE_COMPONENTS_V2_MENU_DIVIDER_LABEL`)
- `NOODLE_COMPONENTS_V2_MENU_IMAGE_URL` - optional HTTPS image URL prepended to V2 menu guide containers
- `NOODLE_COMPONENTS_V2_MENU_SHOW_DIVIDER` - set `0`/`false` to disable automatic divider insertion before first action row (default enabled)
- `NOODLE_V2_SCENE_MAX_ENTRIES` - maximum in-memory V2 scene-state entries before eviction guardrails apply (default `2000`)
- `NOODLE_V2_SCENE_TTL_MS` - optional global TTL override (milliseconds) for V2 scene-state entries; when unset, per-scene defaults are used
- `NOODLE_OFFICIAL_GUILD_ID` (falls back to `DISCORD_GUILD_ID`) - guild where alerts are sent
- `NOODLE_DEV_ALERT_CHANNEL_ID` - channel ID in the official guild for alerts
- `NOODLE_DEV_ALERT_USER_ID` - user ID that is required for alert mention/ping behavior
- `NOODLE_OFFICIAL_FEATURE_CANARY` - defaults enabled (`1`); routes new player-feature interactions to the dev alert channel until explicitly disabled after review
- `NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED` - set `1` only after verifying the dev alert channel is visible only to the bot and designated reviewer; without this attestation, the counting canary does not process messages
- `NOODLE_OFFICIAL_COUNTING_ENABLED` - set `1` to enable counting after setup and approval (default disabled); requires the reviewed-copy acknowledgement below, message-content intent, and a verified canary or explicitly selected production channel
- `NOODLE_OFFICIAL_COUNTING_COPY_APPROVED` - set `1` only after the user has reviewed and approved counting reset and milestone-reward wording; default disabled
- `NOODLE_OFFICIAL_COUNTING_REWARDS_ENABLED` - set `1` to grant counting milestone rewards; default disabled, and still requires counting copy approval
- `NOODLE_OFFICIAL_COUNTING_CHANNEL_ID` - normal official counting channel ID; ignored while feature canary routing is enabled
- `NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT` - set `1` only when the Discord application's privileged message-content intent is enabled; required for counting
- Counting reward values are editable and approved in `content/counting.rewards.json`; feature and release gates still apply before enabling rewards.
- `NOODLE_WORK_PING_ENABLED` - set `1` to enable work pings at 00:00, 02:00, 04:00, 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, and 22:00 UTC; no startup ping is sent
- `NOODLE_WORK_PING_COPY_APPROVED` - set `1` only after the work-ping wording is reviewed and approved
- `NOODLE_WORK_PING_PRODUCTION_ENABLED` - separately approve sending work pings to the production channel after private-canary review
- `NOODLE_WORK_CHANNEL_ID` - channel where players use `/work`; linked by the editable `content/work-ping.json` message
- `NOODLE_WORK_PING_CHANNEL_ID` and `NOODLE_WORK_PING_ROLE_ID` - production ping destination and role to mention; ignored for private canaries
- In private-canary mode (`NOODLE_OFFICIAL_FEATURE_CANARY` is unset or `1`), work pings route to `NOODLE_DEV_ALERT_CHANNEL_ID`, require `NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED=1`, and do not mention a role. The scheduler replaces its last persisted ping before posting another. Work pings and bot-authored counting notices use Components V2 containers.
- `NOODLE_GIVEAWAYS_ENABLED` - set `1` to enable the giveaway lifecycle; default disabled
- `NOODLE_GIVEAWAYS_CANARY_PREVIEW` - set `1` to post a private, non-interactive giveaway preview; it cannot collect entries or grant prizes
- `NOODLE_GIVEAWAYS_COPY_APPROVED` - set `1` only after the giveaway and winner-confirmation copy and prize values are reviewed and approved
- `NOODLE_GIVEAWAYS_PRODUCTION_ENABLED` - separately approve live weekly contests and reward fulfillment after private-canary review
- `NOODLE_GIVEAWAY_CHANNEL_ID` - production giveaway destination; entries close seven days after the Wednesday 21:00 UTC start
- `NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID` - shared production role tagged in live giveaways and regular game updates; required by both production routes and suppressed in private canaries
- `NOODLE_GIVEAWAY_VALOR_FULFILLER_ID` - Erma's Discord user ID, required for manual VALOR fulfillment and the one-time public fulfillment confirmation
- Private giveaway canaries route to `NOODLE_DEV_ALERT_CHANNEL_ID`, require the private-channel attestation, and have no entry button or reward side effects. Live production additionally requires explicit copy and production approvals. Approved prize values and prize-pool tiers are in `content/giveaways.json`.
- After Erma manually sends a VALOR reward, Erma can use `/noodle-dev admin giveaway_valor_fulfilled` with the giveaway ID to post a winner-tagged public confirmation. The command is unavailable until giveaway copy is approved, requires a matching official-guild giveaway and the configured fulfiller account, and is claim-once; uncertain delivery requires channel verification before manual recovery.
- `NOODLE_GAME_UPDATES_ENABLED` - set `1` to enable scheduled update and season/event announcement delivery; default disabled. Season/event transitions are tracked in SQLite while delivery is gated, provided the official guild ID is configured.
- `NOODLE_GAME_UPDATES_COPY_APPROVED` - set `1` only after reviewing all update and season/event announcement copy in `content/game-updates.md` and the runtime-generated season text.
- `NOODLE_GAME_UPDATES_PRODUCTION_ENABLED` - separately approve production delivery after private-canary review
- `NOODLE_GAME_UPDATES_CHANNEL_ID` - official production game-update destination; ignored while private canary routing is enabled
- `NOODLE_GAME_UPDATES_EVENTS_ROLE_ID` - official-server second role tagged by every production game update, alongside `NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID`; season/event update copy can place this mention at the event-role placeholder. Required for production game-update routing and suppressed in private canaries.
- In private-canary mode (`NOODLE_OFFICIAL_FEATURE_CANARY` is unset or `1`), scheduled updates route to `NOODLE_DEV_ALERT_CHANNEL_ID` and require verified privacy; no roles are mentioned. Production routing additionally requires `NOODLE_GAME_UPDATES_PRODUCTION_ENABLED=1`, a verified channel, and valid IDs for both the shared announcements role and game-updates role. Scheduled game updates and season/event change notices are Components V2 containers; the send path rejects any non-container payload.
- Edit configured update entries in `content/game-updates.md`, then use `/noodle-dev admin game_update_preview` and `/noodle-dev admin game_update_schedule`. Scheduling stores a content snapshot and requires a future ISO-8601 time with timezone. Mark the comprehensive first player update with `rollout_summary: true`; other scheduled and season/event posts remain queued until that first update has been sent to production.
- For game updates, work pings, and giveaway posts/previews/winner confirmations, delivery failures after sending begins are recorded as `delivery_unknown` and are not retried automatically because retrying could duplicate a player-facing message. Stale `sending` records are moved to that state by recurring recovery checks. After checking the configured Discord channel, an administrator can use `/noodle-dev admin delivery_reconcile` to record the message ID if delivered, or mark it not delivered only after explicitly verifying that no message exists. This requeues only the specific item; never use `not_delivered` while an active sender could still complete.
- `delivery_reconcile` accepts scheduled-message IDs `work_ping` and `giveaway_preview`, a game-update schedule ID, a season-update guild ID, or a giveaway ID with the matching delivery type. For a confirmed delivery, provide the Discord message ID; the channel and (for updates) canary/production mode are taken from the destination recorded when the send was attempted, not from the current environment, and a record without that provenance cannot be marked delivered. For a retry decision, set `verified_absent`; production rollout-summary reconciliation records the public release gate transactionally. A cleared giveaway-preview attempt is retried at scheduler startup, so restart the bot after verifying absence. Keep the recovery action and Discord verification in the operational incident log.
- `NOODLE_FORCE_UNICODE_EMOJI` - set `1` to force standard Unicode emoji instead of custom emoji (recommended for tester bot environments where custom emoji may be unavailable)
- `NOODLE_STARTUP_AVATAR_ENABLED` - set `1` to enable startup avatar sync via Discord API (default disabled)
- `NOODLE_STARTUP_AVATAR_GIF_URL` - HTTPS URL to the avatar asset to apply at startup (use a GIF for animated avatars)

## Command Registration Env Vars

- `DISCORD_GUILD_ID` - explicit guild target for workflow-driven guild registration; this takes precedence over `NOODLE_OFFICIAL_GUILD_ID` and `NOODLE_DEV_GUILD_ID` when registering commands in guild mode
- `NOODLE_OFFICIAL_GUILD_ID` - official runtime guild for alerts, social bridge checks, and other official-guild-only flows; runtime code still prefers this value before `NOODLE_DEV_GUILD_ID` and `DISCORD_GUILD_ID`

## Gameplay Tuning Env Vars

- `NOODLE_ORDER_ACCEPT_CAP_BASE` - base max accepted orders per player (default `5`)
- `NOODLE_ORDER_ACCEPT_CAP_HOUSE_247` - storage/pruning cap used for accepted-order persistence under 24/7 House-scale workloads (default `500`)
- `NOODLE_TAKEOUT_DISCOVERY_MAX_ATTEMPTS` - caps per-shift takeout discovery roll attempts processed in catch-up paths (default `12`)

## Telemetry Env Vars

- `NOODLE_TELEMETRY_LOG_DISABLED` - set `1` to disable file telemetry entirely
- `NOODLE_TELEMETRY_LOG_PATH` - optional custom path for telemetry JSONL output (default: `noodle-logs/telemetry.log`)
- `NOODLE_TELEMETRY_MODE` - `all` (default), `slow` (only `interaction_slow_event` + `rate_limited`), or `off` (alias: `none`)
- `NOODLE_TELEMETRY_SAMPLE_RATE` - `0..1` sampling rate for high-volume events (`interaction_latency`, `component_nav_phase`, `component_nav_subroute_phase`)
- Counting message processing requires `NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT=1` and the matching privileged Discord intent to be enabled for the application.
- `NOODLE_TELEMETRY_MAX_BUFFER_BYTES` - max write buffer guard (default `262144`); events are dropped under sustained backpressure to protect process memory
- `NOODLE_V2_TELEMETRY_REPORTS_ENABLED` - set `1` to enable scheduled bot-health reports (the variable keeps its legacy V2 name)
- `NOODLE_TELEMETRY_ALERT_CHANNEL_ID` - separate channel ID in the official guild for bot-health reports; required when reports are enabled and must differ from `NOODLE_DEV_ALERT_CHANNEL_ID`
- `NOODLE_V2_TELEMETRY_REPORT_INTERVAL_MS` - report interval in milliseconds (default `21600000` / 6h, minimum 5m)
- `NOODLE_V2_TELEMETRY_REPORT_WINDOW_HOURS` - rolling analysis window hours per report (default `24`)
- `NOODLE_V2_TELEMETRY_ALERT_MIN_INTERACTIONS` - minimum valid interaction-duration samples before interaction-threshold evaluation (default `20`; `NOODLE_V2_TELEMETRY_ALERT_MIN_LOOPS` remains a fallback alias)
- `NOODLE_V2_TELEMETRY_ALERT_INTERACTION_P95_MS` - high-issue threshold for measured interaction-handler p95 duration in milliseconds (default `20000`; `NOODLE_V2_TELEMETRY_ALERT_LOOP_P95_MS` is not used because completed-flow elapsed time is not server latency)
- `NOODLE_V2_TELEMETRY_ALERT_CLICK_AVG` - high-issue threshold for average clicks per completed V2 flow (default `6`)
- `NOODLE_V2_TELEMETRY_ALERT_INTERACTION_ERROR_RATE_PCT` - high-issue threshold for failed measured interactions (default `8%`)
- `NOODLE_V2_TELEMETRY_ALERT_ROUTE_ERROR_RATE_PCT` - high-issue threshold for V2 route-error signals divided by recorded `v2_scene_transition` events (default `8%`; legacy `NOODLE_V2_TELEMETRY_ALERT_ERROR_RATE_PCT` remains a fallback alias; this diagnostic ratio is not an overall command failure rate)
- `NOODLE_V2_TELEMETRY_ALERT_P95_REGRESSION_PCT` - high-issue threshold for p95 regression vs prior window (default `20`)
- Reports compare the selected window with the immediately preceding window and include measured interaction-handler p50/p95, valid/error sample counts, observed scheduled-job outcomes, hard operation/delivery failure signals, gateway lifecycle events, process-start events, collection mode, sampling rate, malformed/unknown record warnings, and recommendations tied to observed issues. Completed V2-flow elapsed time is reported separately because it includes player time between clicks. Application telemetry has no independent heartbeat, so reports cannot calculate continuous uptime, detect unobserved downtime, or establish Discord availability. Job results cover emitted runs only; disabled or gated jobs are not evidence of failures. `slow` mode omits ordinary interaction latency, scheduled-job outcomes, and gateway lifecycle events, so it cannot produce representative bot-health measurements. See [FEATURE_ROLLOUT_ENVIRONMENT.md](FEATURE_ROLLOUT_ENVIRONMENT.md) for rollout-specific configuration details.

## Database Backup Env Vars

- `NOODLE_BACKUP_DIR` - directory for dated backups and `latest.sqlite` (default `data/backups`; use a path that survives redeploys and copy backups off the host)
- `NOODLE_BACKUP_CRON` - UTC cron schedule for recurring backups (default `0 3 * * *`)
- `NOODLE_BACKUP_RETAIN` - number of dated backups to keep (default `14`)
- `NOODLE_BACKUP_ON_START` - set `0` to disable the delayed startup backup (the scheduled backup still runs)

## Reminder Env Vars

- `NOODLE_DAILY_REMINDER_CRON` - cron expression for the daily reward reminder DM job; default is `15 0 * * *` (UTC daily at 00:15)
- `NOODLE_DAILY_REMINDER_MAX_INACTIVE_DAYS` - skips reminder sends for players inactive longer than this many days (default `30`)

## Official Stats Counter Env Vars

- `NOODLE_OFFICIAL_STATS_CHANNELS_ENABLED` - set `0` to disable official stats counter updates
- `NOODLE_OFFICIAL_STATS_CHANNEL_REFRESH_INTERVAL_MS` - optional refresh interval in ms for scheduled counter updates (minimum enforced to 60,000)
- `NOODLE_OFFICIAL_SERVER_COUNT_CHANNEL_ID`, `NOODLE_OFFICIAL_SHOP_COUNT_CHANNEL_ID`, `NOODLE_OFFICIAL_MEMBER_COUNT_CHANNEL_ID` - explicit voice channel IDs for the official counters; set each one for the specific counter you want to enable
- `NOODLE_OFFICIAL_SERVER_COUNT_LABEL`, `NOODLE_OFFICIAL_SHOP_COUNT_LABEL`, `NOODLE_OFFICIAL_MEMBER_COUNT_LABEL` - optional display labels used when renaming the corresponding configured channels
- `NOODLE_OFFICIAL_STATS_CATEGORY_ID` - optional category ID; configured channels are moved here when set
- PebbleHost note: set these values in your PebbleHost server files environment configuration so they load at runtime

## Store/Webhook-Related Env Vars

- `NOODLE_WEBHOOK_PORT` - enables the webhook HTTP server when set
- `NOODLE_WEBHOOK_PATH` - Discord entitlement webhook path (default `/discord/entitlements`)
- `NOODLE_WEBHOOK_LOG_FILE` - optional webhook log file path (default `noodle-logs/webhooks.log`)
- `NOODLE_WEBHOOK_LOG_TO_CONSOLE` - set `1` to mirror webhook `error` logs to console in addition to file output
- `NOODLE_TOPGG_WEBHOOK_PATH` + `NOODLE_TOPGG_WEBHOOK_AUTH` (fallback: `TOPGG_WEBHOOK_AUTH`) - Top.gg vote webhook path/auth
- `NOODLE_TOPGG_REQUIRE_SIGNATURE` - set `1` to require valid `x-topgg-signature` and disable token fallback for Top.gg webhooks
- `NOODLE_RANKTOP_WEBHOOK_PATH` + `NOODLE_RANKTOP_WEBHOOK_AUTH` - Rank.top vote webhook path/auth
- `NOODLE_DISCORDBOTLIST_WEBHOOK_PATH` + `NOODLE_DISCORDBOTLIST_WEBHOOK_AUTH` - Discord Bot List vote webhook
- `NOODLE_VOIDBOTS_WEBHOOK_PATH` + `NOODLE_VOIDBOTS_WEBHOOK_AUTH` - Void Bots vote webhook
- `NOODLE_DISCORDS_WEBHOOK_PATH` + `NOODLE_DISCORDS_WEBHOOK_AUTH` - Discords.com vote webhook
- `NOODLE_BOTLISTME_WEBHOOK_PATH` + `NOODLE_BOTLISTME_WEBHOOK_AUTH` - BotList.me vote webhook
- `NOODLE_STELLARBOTLIST_WEBHOOK_PATH` + `NOODLE_STELLARBOTLIST_WEBHOOK_AUTH` - Stellar Bot List vote webhook
- `NOODLE_DISCORDLISTGG_WEBHOOK_PATH` + `NOODLE_DISCORDLISTGG_WEBHOOK_AUTH` - DiscordList.gg vote webhook
- `NOODLE_RADARCPDV_WEBHOOK_PATH` + `NOODLE_RADARCPDV_WEBHOOK_AUTH` - Radar.CPDV vote webhook
- `NOODLE_TOPGG_TOKEN` (fallbacks: `TOPGG_TOKEN`, `TOPGG_API_TOKEN`) + `NOODLE_TOPGG_STATS_URL` - Top.gg server count sync target (`NOODLE_TOPGG_STATS_URL` optional; default built in)
- `NOODLE_RANKTOP_TOKEN` + `NOODLE_RANKTOP_STATS_URL` - Rank.top server count sync target (`NOODLE_RANKTOP_STATS_URL` optional; default `https://rank.top/api/bots/{botId}/post`)
- `NOODLE_RANKTOP_INCLUDE_AUTHORIZATION_HEADER` - set `0` to omit Authorization header on Rank.top outbound sync (default `1`)
- `NOODLE_RANKTOP_AUTH_SCHEME` - Authorization header scheme for Rank.top outbound sync: `bearer` (default) or `raw`
- `NOODLE_RANKTOP_INCLUDE_API_KEY_HEADER` - set `0` to stop sending an API-key header for Rank.top outbound sync (default `1` sends both `Authorization: Bearer <token>` and API-key header)
- `NOODLE_RANKTOP_API_KEY_HEADER` - optional API-key header name for Rank.top outbound sync (default `x-api-key`)
- `NOODLE_RANKTOP_POST_AUTHORIZATION` - optional Rank.top post authorization token sent in POST JSON body as `authorization` (defaults to `NOODLE_RANKTOP_WEBHOOK_AUTH` when unset)
- `NOODLE_RANKTOP_AUTH_PREFLIGHT` - set `1` to run a startup Rank.top auth preflight GET request and log the exact API response status/body snippet
- `NOODLE_RANKTOP_PREFLIGHT_URL` - optional preflight endpoint template with `{botId}` replacement (default `https://rank.top/api/bots/{botId}/stats`)
- `NOODLE_RANKTOP_SYNC_COMMANDS` - set `0` to disable Rank.top command-list sync (default enabled); this also excludes `commands` from Rank.top periodic stats payloads to avoid unnecessary command reposting
- `NOODLE_RANKTOP_COMMANDS_URL` - optional Rank.top command-list endpoint override (default `https://rank.top/api/bots/{botId}/post`)
- `NOODLE_RANKTOP_INCLUDE_DEV_COMMANDS` - set `1` to include `noodle-dev` in Rank.top command list (default excluded)
- `NOODLE_DEBUG_RANKTOP_AUTH` - set `1` to emit redacted Rank.top auth diagnostics at startup and on stats/command sync requests (token lengths, whitespace/newline flags, hash prefixes, resolved bot id)
- `NOODLE_DISCORDBOTLIST_TOKEN` + `NOODLE_DISCORDBOTLIST_STATS_URL` - Discord Bot List stats sync target (`NOODLE_DISCORDBOTLIST_STATS_URL` optional; default built in). Sends `guilds`, `users`, and optional `voice_connections`.
- `NOODLE_DISCORDBOTLIST_VOICE_CONNECTIONS` - optional static voice connection count value for Discord Bot List stats payloads
- `NOODLE_BOTLIST_STATS_SYNC_INTERVAL_MS` - optional periodic stats heartbeat interval (default `3600000` ms / 1 hour)
- `NOODLE_BOTLIST_STATS_MIN_INTERVAL_MS` - optional minimum gap between stats POSTs per provider across ready/guild events/heartbeat (default `3600000` ms / 1 hour)
- `NOODLE_VOTE_DUPLICATE_WINDOW_MODE` - optional duplicate suppression mode for vote retries: `sliding` (default) extends the 5-minute window on repeated retries; `fixed` keeps a fixed window from first seen webhook
- `NOODLE_DISCORDBOTLIST_SYNC_COMMANDS` - set `0` to disable Discord Bot List command-list sync (default enabled)
- `NOODLE_DISCORDBOTLIST_COMMANDS_URL` - optional command-list endpoint override (default `https://discordbotlist.com/api/v1/bots/{botId}/commands`)
- `NOODLE_DISCORDBOTLIST_INCLUDE_DEV_COMMANDS` - set `1` to include `noodle-dev` in Discord Bot List command list (default excluded)
- `NOODLE_DISCORDBOTLIST_COMMANDS_WRAP` - set `1` to send command sync payload as `{ commands: [...] }` instead of a bare array
- `NOODLE_VOIDBOTS_TOKEN` + `NOODLE_VOIDBOTS_STATS_URL` - Void Bots server count sync target
- `NOODLE_DISCORDS_TOKEN` + `NOODLE_DISCORDS_STATS_URL` - Discords.com server count sync target
- `NOODLE_BOTLISTME_TOKEN` + `NOODLE_BOTLISTME_STATS_URL` - BotList.me server count sync target
- `NOODLE_BOTLISTME_SYNC_STATS` - set `0` to pause BotList.me outbound server-count sync attempts without removing webhook or token config
- `NOODLE_DISCORDBOTSGG_TOKEN` + `NOODLE_DISCORDBOTSGG_STATS_URL` - Discord.Bots.gg server count sync target using `guildCount` payload format (no vote rewards; `NOODLE_DISCORDBOTSGG_STATS_URL` optional; default built in)
- `NOODLE_DISCORDLISTGG_TOKEN` + `NOODLE_DISCORDLISTGG_STATS_URL` - DiscordList.gg server count sync target
- `NOODLE_RADARCPDV_TOKEN` + `NOODLE_RADARCPDV_STATS_URL` - Radar.CPDV server count sync target
- `NOODLE_RADARCPDV_SYNC_STATS` - set `0` to pause Radar.CPDV outbound server-count sync attempts without removing webhook or token config
- `NOODLE_RADARCPDV_SYNC_COMMANDS` - set `0` to disable Radar.CPDV command-list sync (default enabled)
- `NOODLE_RADARCPDV_COMMANDS_URL` - optional Radar.CPDV command-list endpoint override (default `https://api.radarcord.net/bot/{botId}/commands`)
- `NOODLE_RADARCPDV_INCLUDE_DEV_COMMANDS` - set `1` to include `noodle-dev` in Radar.CPDV command list (default excluded)
- `NOODLE_RADARCPDV_COMMANDS_WRAP` - set `1` to send command sync payload as `{ commands: [...] }` instead of a bare array
- `NOODLE_DISCORDEXTREMELIST_TOKEN` + `NOODLE_DISCORDEXTREMELIST_STATS_URL` - Discord Extreme List server count sync target using `serverCount`/`guildCount` payload format
- `NOODLE_BOT_ID` - optional shared bot id for endpoints that include `{botId}` in their URL template (defaults to live client id, then legacy `TOPGG_BOT_ID`, then `1460058511802105976`)
- `TOPGG_BOT_ID` - legacy fallback for `NOODLE_BOT_ID` compatibility
- `DISCORD_PUBLIC_KEY` - required to verify Discord entitlement signatures
- `NOODLE_STRIPE_WEBHOOK_PATH` - Stripe webhook path (default `/store/stripe`)
- `NOODLE_STRIPE_WEBHOOK_SECRET` - Stripe signing secret for webhook validation
- `NOODLE_STRIPE_PRECHECK_PATH` and `NOODLE_STRIPE_PRECHECK_SECRET` - optional store precheck endpoint
- `NOODLE_SUBSCRIPTION_SKU_MAP` - maps Discord store SKU IDs to paid subscription perks for entitlement lifecycle handling. Only `takeout_counter` is accepted. Accepts JSON (`{"<takeout_counter_sku_id>":"takeout_counter"}`) or comma-separated pairs (`<sku_id>:takeout_counter`).
- `NOODLE_COIN_PACK_SKU_MAP` - maps Discord store SKU IDs to coin packs. Supported pack IDs: `coin_pack_099` (10,000c), `coin_pack_199` (25,000c), `coin_pack_499` (100,000c). When unset, built-in defaults are used: `1511191985644507336 -> coin_pack_099`, `1511192707119321109 -> coin_pack_199`, `1511192852288376884 -> coin_pack_499`.
- `NOODLE_COIN_PACK_PRODUCT_MAP` - maps Stripe metadata product IDs (or `spec_id`) to coin pack IDs using the same values as `NOODLE_COIN_PACK_SKU_MAP`.

## PebbleHost .env Template

```dotenv
# Shared webhook server
NOODLE_WEBHOOK_PORT=3000
# Optional: periodic bot-list stats heartbeat interval (default 1 hour)
# NOODLE_BOTLIST_STATS_SYNC_INTERVAL_MS=3600000
# Optional: minimum gap between per-provider stats sync attempts (default 1 hour)
# NOODLE_BOTLIST_STATS_MIN_INTERVAL_MS=3600000
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

# Rank.top
NOODLE_RANKTOP_WEBHOOK_PATH=/ranktop/webhook
NOODLE_RANKTOP_WEBHOOK_AUTH=replace_with_ranktop_webhook_auth
NOODLE_RANKTOP_TOKEN=replace_with_ranktop_api_token
# Optional: explicit post-body authorization token for /post endpoint (falls back to NOODLE_RANKTOP_WEBHOOK_AUTH)
# NOODLE_RANKTOP_POST_AUTHORIZATION=replace_with_ranktop_post_authorization
# Optional override (default is built in)
# NOODLE_RANKTOP_STATS_URL=https://rank.top/api/bots/{botId}/post
# Optional: dual-auth header controls for Rank.top outbound sync
# NOODLE_RANKTOP_INCLUDE_AUTHORIZATION_HEADER=1
# NOODLE_RANKTOP_AUTH_SCHEME=bearer
# NOODLE_RANKTOP_INCLUDE_API_KEY_HEADER=1
# NOODLE_RANKTOP_API_KEY_HEADER=x-api-key
# Optional: startup auth preflight diagnostics
# NOODLE_RANKTOP_AUTH_PREFLIGHT=0
# NOODLE_RANKTOP_PREFLIGHT_URL=https://rank.top/api/bots/{botId}/stats
# Optional: command-list sync controls
# NOODLE_RANKTOP_SYNC_COMMANDS=1
# NOODLE_RANKTOP_COMMANDS_URL=https://rank.top/api/bots/{botId}/post
# NOODLE_RANKTOP_INCLUDE_DEV_COMMANDS=0
# Optional: emit redacted runtime auth diagnostics for troubleshooting
# NOODLE_DEBUG_RANKTOP_AUTH=0

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
# Optional: pause outbound server-count sync without removing token
# NOODLE_RADARCPDV_SYNC_STATS=1
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
# Webhook-only provider (no outbound server-count sync configured).

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
# Optional: pause outbound server-count sync without removing token
# NOODLE_BOTLISTME_SYNC_STATS=1

# Shared bot id template replacement for URLs that use {botId}
NOODLE_BOT_ID=1460058511802105976
# Legacy fallback (optional)
# TOPGG_BOT_ID=1460058511802105976
```

## Alert Behavior

- Guild join alerts, Discord entitlement purchase alerts, and Stripe purchase alerts all use a single formatting path.
- Alerts require `NOODLE_DEV_ALERT_USER_ID` when mention is required.
- Guild join/leave alerts include current server count in the embed footer.
- Guild join/leave events also POST updated stats (guild and user counts when supported) to each configured bot list endpoint.
- Purchase alerts include specialization purchase count in the embed footer (all-time from durable purchase history).
- Bot-health reports (`NOODLE_V2_TELEMETRY_REPORTS_ENABLED=1`) are posted on a schedule to `NOODLE_TELEMETRY_ALERT_CHANNEL_ID`; the scheduler does not start if this dedicated channel is missing or matches the dev alert channel.
- High telemetry issue reports automatically escalate to mention alerts when thresholds are breached.
