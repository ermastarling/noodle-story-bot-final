# Feature Rollout Environment Variables

This guide is for updating an existing PebbleHost environment. **Do not replace your existing `.env` or environment configuration.** Add only missing keys from the block below; if a key is already present, edit that existing value instead of creating a duplicate. Keep your existing bot token, guild ID, private canary channel ID, and other unrelated settings as they are.

The feature switches below start disabled. Blank channel and role IDs are intentional placeholders: fill them with the IDs from your server before enabling the associated production route. Do not change the approval or production switches to `1` until the corresponding copy, private canary, permissions, and release checks are complete.

## PebbleHost Copy/Paste Values

```dotenv
# Shared canary gate; keep canary on until a production rollout is explicitly approved.
NOODLE_OFFICIAL_FEATURE_CANARY=1
NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED=0

# Counting
NOODLE_OFFICIAL_COUNTING_ENABLED=0
NOODLE_OFFICIAL_COUNTING_COPY_APPROVED=0
NOODLE_OFFICIAL_COUNTING_REWARDS_ENABLED=0
NOODLE_OFFICIAL_COUNTING_CHANNEL_ID=
NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT=0

# Work pings
NOODLE_WORK_PING_ENABLED=0
NOODLE_WORK_PING_COPY_APPROVED=0
NOODLE_WORK_PING_PRODUCTION_ENABLED=0
NOODLE_WORK_CHANNEL_ID=
NOODLE_WORK_PING_CHANNEL_ID=
NOODLE_WORK_PING_ROLE_ID=

# Giveaways
NOODLE_GIVEAWAYS_ENABLED=0
NOODLE_GIVEAWAYS_CANARY_PREVIEW=0
NOODLE_GIVEAWAYS_COPY_APPROVED=0
NOODLE_GIVEAWAYS_PRODUCTION_ENABLED=0
NOODLE_GIVEAWAY_CHANNEL_ID=
NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID=
NOODLE_GIVEAWAY_VALOR_FULFILLER_ID=

# Game and season updates
NOODLE_GAME_UPDATES_ENABLED=0
NOODLE_GAME_UPDATES_COPY_APPROVED=0
NOODLE_GAME_UPDATES_PRODUCTION_ENABLED=0
NOODLE_GAME_UPDATES_CHANNEL_ID=
NOODLE_GAME_UPDATES_EVENTS_ROLE_ID=

# Telemetry collection and measured health reports
NOODLE_TELEMETRY_LOG_DISABLED=0
NOODLE_TELEMETRY_MODE=all
NOODLE_TELEMETRY_SAMPLE_RATE=1
NOODLE_TELEMETRY_MAX_BUFFER_BYTES=262144
NOODLE_V2_TELEMETRY_REPORTS_ENABLED=0
NOODLE_TELEMETRY_ALERT_CHANNEL_ID=
NOODLE_V2_TELEMETRY_REPORT_INTERVAL_MS=21600000
NOODLE_V2_TELEMETRY_REPORT_WINDOW_HOURS=24
NOODLE_V2_TELEMETRY_ALERT_MIN_INTERACTIONS=20
NOODLE_V2_TELEMETRY_ALERT_INTERACTION_P95_MS=20000
NOODLE_V2_TELEMETRY_ALERT_CLICK_AVG=6
NOODLE_V2_TELEMETRY_ALERT_INTERACTION_ERROR_RATE_PCT=8
NOODLE_V2_TELEMETRY_ALERT_ROUTE_ERROR_RATE_PCT=8
NOODLE_V2_TELEMETRY_ALERT_P95_REGRESSION_PCT=20

# Database backups
NOODLE_BACKUP_DIR=data/backups
NOODLE_BACKUP_CRON=0 3 * * *
NOODLE_BACKUP_RETAIN=14
NOODLE_BACKUP_ON_START=1
```

`NOODLE_OFFICIAL_GUILD_ID` and `NOODLE_DEV_ALERT_CHANNEL_ID` are intentionally not included because they are shared existing server settings: keep or update the values already configured in PebbleHost rather than adding duplicate entries. For a private canary, verify the channel is visible only to the bot and designated reviewer, then set `NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED=1`. Role IDs and production channel IDs are server-specific; use the existing PebbleHost value editor to fill those in.

This reference also explains each setting below. It complements the full [environment guide](ENVIRONMENT.md).

## Shared Official-Guild Routing and Approvals

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_OFFICIAL_GUILD_ID` | Falls back to `DISCORD_GUILD_ID` | Official guild for feature routing and guild-scoped checks. |
| `NOODLE_DEV_ALERT_CHANNEL_ID` | Required for private canaries | Private-canary destination. Verify that only the bot and designated reviewer can view it. |
| `NOODLE_DEV_ALERT_USER_ID` | Required only when an alert needs a mention | User to mention in configured operational alerts. |
| `NOODLE_OFFICIAL_FEATURE_CANARY` | Defaults to `1`; set `0` to select production routing | Keeps new feature messages in the private canary until promotion. |
| `NOODLE_OFFICIAL_FEATURE_CANARY_PRIVATE_VERIFIED` | Defaults unset; set `1` only after access is verified | Attests that the canary channel is private. Required before canary messages are sent by the gated features. |

The feature-specific `*_COPY_APPROVED` variables below are explicit acknowledgements, not substitutes for reviewing the copy. Keep feature delivery disabled until routing, permissions, copy, and release gates are verified.

## Counting

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_OFFICIAL_COUNTING_ENABLED` | Defaults disabled; set `1` to enable | Enables counting message processing after setup and approval. |
| `NOODLE_OFFICIAL_COUNTING_COPY_APPROVED` | Defaults disabled; set `1` after copy review | Acknowledges review of reset and milestone-reward wording. |
| `NOODLE_OFFICIAL_COUNTING_REWARDS_ENABLED` | Defaults disabled; set `1` to enable rewards | Separately enables milestone rewards; still requires counting and copy approval. |
| `NOODLE_OFFICIAL_COUNTING_CHANNEL_ID` | Required for production routing | Official counting channel; ignored while private-canary routing is active. |
| `NOODLE_OFFICIAL_ENABLE_MESSAGE_CONTENT_INTENT` | Defaults disabled; set `1` only when the Discord application intent is enabled | Confirms the privileged message-content intent required to read count messages. |

Counting rewards are configured in `content/counting.rewards.json`; these environment settings do not configure reward amounts.

## Work Pings

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_WORK_PING_ENABLED` | Defaults disabled; set `1` to enable | Enables scheduled even-hour UTC work pings. No startup ping is sent. |
| `NOODLE_WORK_PING_COPY_APPROVED` | Defaults disabled; set `1` after copy review | Acknowledges review of the work-ping text. |
| `NOODLE_WORK_PING_PRODUCTION_ENABLED` | Defaults disabled; set `1` after canary review | Separately approves production-channel delivery. |
| `NOODLE_WORK_CHANNEL_ID` | Required channel ID | Channel linked from the ping where players use `/work`. |
| `NOODLE_WORK_PING_CHANNEL_ID` | Required for production delivery | Production destination; ignored during private-canary routing. |
| `NOODLE_WORK_PING_ROLE_ID` | Required for production role mentions | Role mentioned by production pings; mentions are suppressed in canary mode. |

## Giveaways

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_GIVEAWAYS_ENABLED` | Defaults disabled; set `1` to enable | Enables the giveaway lifecycle. |
| `NOODLE_GIVEAWAYS_CANARY_PREVIEW` | Defaults disabled; set `1` for a private preview | Posts a non-interactive preview only; it cannot collect entries or grant prizes. |
| `NOODLE_GIVEAWAYS_COPY_APPROVED` | Defaults disabled; set `1` after reviewing wording and prizes | Acknowledges review of giveaway and winner-confirmation copy and values. |
| `NOODLE_GIVEAWAYS_PRODUCTION_ENABLED` | Defaults disabled; set `1` after canary review | Separately approves live contests and reward fulfillment. |
| `NOODLE_GIVEAWAY_CHANNEL_ID` | Required for production delivery | Production giveaway channel. Contests begin Wednesday at 21:00 UTC and close seven days later. |
| `NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID` | Required for production giveaways and game updates | Shared role tagged by live giveaways and every production game-update post, including season/event updates; ignored in private canaries. |
| `NOODLE_GIVEAWAY_VALOR_FULFILLER_ID` | Required for manual VALOR fulfillment | Discord user allowed to confirm that a manually sent VALOR prize was fulfilled. |

Private canaries have no entry button or reward side effects. Prize definitions are in `content/giveaways.json`.

## Game and Season Updates

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_GAME_UPDATES_ENABLED` | Defaults disabled; set `1` to enable | Enables scheduled update and season/event announcement processing. |
| `NOODLE_GAME_UPDATES_COPY_APPROVED` | Defaults disabled; set `1` after reviewing configured and generated text | Acknowledges review of content in `content/game-updates.md` and runtime-generated season text. |
| `NOODLE_GAME_UPDATES_PRODUCTION_ENABLED` | Defaults disabled; set `1` after canary review | Separately approves production-channel delivery. |
| `NOODLE_GAME_UPDATES_CHANNEL_ID` | Required for production delivery | Production update destination; ignored during private-canary routing. |
| `NOODLE_GAME_UPDATES_EVENTS_ROLE_ID` | Required for all production game updates | Second role tagged by production game updates, alongside `NOODLE_ROLLOUT_ANNOUNCEMENTS_ROLE_ID`; season/event copy can place this mention at its role placeholder. Suppressed in private canaries. |

Manual updates are previewed and scheduled through `/noodle-dev admin`; season transitions are tracked while delivery remains gated. Scheduled content is in `content/game-updates.md`.

## Telemetry and Measured Health Reports

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_TELEMETRY_LOG_DISABLED` | Defaults enabled; set `1` to disable file telemetry | Disables telemetry collection entirely. |
| `NOODLE_TELEMETRY_LOG_PATH` | `noodle-logs/telemetry.log` | Optional telemetry JSONL path; relative paths resolve under `noodle-logs/`. |
| `NOODLE_TELEMETRY_MODE` | `all` by default; `slow`; `off` / `none` | `slow` records only slow-interaction and rate-limit events; it omits ordinary interaction latency, scheduled-job outcomes, and gateway lifecycle events. `off`/`none` disables event collection. |
| `NOODLE_TELEMETRY_SAMPLE_RATE` | `1` by default; range `0..1` | Sampling rate for high-volume interaction-latency and navigation-phase events. Lower rates reduce sample coverage. |
| `NOODLE_TELEMETRY_MAX_BUFFER_BYTES` | `262144`; normalized to `8192..4194304` | Maximum telemetry write-buffer guard. Events can be dropped under sustained backpressure. |
| `NOODLE_V2_TELEMETRY_REPORTS_ENABLED` | Defaults disabled; set `1` to enable | Enables scheduled bot-health reports; the `V2` name is retained for compatibility. |
| `NOODLE_TELEMETRY_ALERT_CHANNEL_ID` | Required when reports are enabled | Dedicated report channel in the official guild; must differ from `NOODLE_DEV_ALERT_CHANNEL_ID`. |
| `NOODLE_V2_TELEMETRY_REPORT_INTERVAL_MS` | `21600000` (6 hours); minimum 5 minutes | How often the report scheduler runs. |
| `NOODLE_V2_TELEMETRY_REPORT_WINDOW_HOURS` | `24`; minimum 1 hour | Rolling analysis window; each report compares it with the immediately preceding window. |
| `NOODLE_V2_TELEMETRY_ALERT_MIN_INTERACTIONS` | `20` | Minimum valid measured interaction durations before interaction-threshold evaluation. `NOODLE_V2_TELEMETRY_ALERT_MIN_LOOPS` is a fallback alias. |
| `NOODLE_V2_TELEMETRY_ALERT_INTERACTION_P95_MS` | `20000` | High-issue threshold for measured interaction-handler p95 duration. |
| `NOODLE_V2_TELEMETRY_ALERT_CLICK_AVG` | `6` | High-issue threshold for average clicks per completed V2 flow. |
| `NOODLE_V2_TELEMETRY_ALERT_INTERACTION_ERROR_RATE_PCT` | `8` | High-issue threshold for failed measured interactions. |
| `NOODLE_V2_TELEMETRY_ALERT_ROUTE_ERROR_RATE_PCT` | `8` | High-issue threshold for V2 route-error signals divided by V2 scene transitions; this is not an overall command failure rate. `NOODLE_V2_TELEMETRY_ALERT_ERROR_RATE_PCT` is a fallback alias. |
| `NOODLE_V2_TELEMETRY_ALERT_P95_REGRESSION_PCT` | `20` | High-issue threshold for measured interaction p95 regression against the preceding window. |

The report summarizes sampled bot interactions, instrumented job runs, hard operation/delivery failure signals, gateway lifecycle events, and V2 diagnostics. The instrumented scheduled jobs include daily reset, event sync, daily reminders, database backup/maintenance, bot-list stats heartbeat, telemetry report runs, work pings, game updates, weekly giveaways, and giveaway previews. Only emitted runs are counted; no run may mean a job was disabled, gated, or not scheduled in that window. The bot has no independent heartbeat, so the report does not calculate continuous uptime, infer offline periods, or measure Discord availability. `NOODLE_V2_TELEMETRY_ALERT_LOOP_P95_MS` is not used because completed-flow elapsed time includes time between player clicks and is not server latency.

## Database Backups

| Variable | Default / accepted values | Purpose |
|---|---|---|
| `NOODLE_BACKUP_DIR` | `data/backups` | Directory for dated database backups and `latest.sqlite`. |
| `NOODLE_BACKUP_CRON` | `0 3 * * *` (03:00 UTC daily) | UTC cron schedule for recurring backups. |
| `NOODLE_BACKUP_RETAIN` | `14` | Number of dated backups to retain when set to a positive integer. |
| `NOODLE_BACKUP_ON_START` | Enabled unless set to `0` | Controls the delayed startup backup; does not disable the scheduled daily backup. |

Take and verify a fresh backup and complete a restore drill before production schema or profile migrations.
