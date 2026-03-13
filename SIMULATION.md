# Simulation Harness

Run a deterministic economy/progression simulation without Discord. Supports multi-guild, latency metrics.

## Usage

```
# Basic
npm run sim -- --days=30 --players=100 --orders-per-day=150 --seed=1337 --start=2026-01-01 --output=sim-output.json

# Multi-guild + more load
npm run sim -- --days=90 --players=500 --guilds=20 --orders-per-day=500 --on-time=0.7 --upgrade-spend=1.0 --include-events=1.0 --season-mode=rolling_days --output=sim-output.json
```

## Options

- `--orders-per-day` orders served per player per day (default: 150)
- `--seed` deterministic seed (default: 1337)
- `--start` start date `YYYY-MM-DD` (default: 2026-01-01)
- `--output` output JSON file (default: sim-output.json)
- `--on-time` chance limited-time orders are served on time (default: 0.7)
- `--upgrade-spend` fraction of coins allowed for upgrades per day (default: 1.0)
- `--include-events` include event recipes/content (default: 1)
- `--season-mode` season rotation mode (default: rolling_days)

Notes:
- When `--include-events` is on, each guild is seeded with the first event as `active_event_id`, so event-limited recipes show up in order boards.
- Order boards are deterministic per guild/day because the RNG seed now includes `serverId` and `dayKey` along with the base seed.
- The sim now rolls daily forage, market stock/prices (buys cheapest affordable item), and quest assignment/progress/claims alongside the serve loop.
- Discovery rolls include `activeEventId`, so event recipes can be learned when events are enabled.
- Seasons default to rolling rotation, so running beyond the season duration will exercise all seasonal recipes.

## Output

The output JSON includes the config, daily season/day keys, per-player summary stats
(average/min/max coins, rep, level, SXP, bowls served, recipes known, total upgrades),
and `metrics` with avg/max ms for instrumented sections (order board generation, serve flow,
badge unlock, upgrade purchases).
