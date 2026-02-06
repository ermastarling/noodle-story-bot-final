# Simulation Harness

Run a deterministic economy/progression simulation without Discord.

## Usage

```
npm run sim -- --days=30 --players=100 --orders-per-day=8 --seed=1337 --start=2026-01-01 --output=sim-output.json
```

## Options

- `--days` number of simulated days (default: 30)
- `--players` number of simulated players (default: 100)
- `--orders-per-day` orders served per player per day (default: 8)
- `--seed` deterministic seed (default: 1337)
- `--start` start date `YYYY-MM-DD` (default: 2026-01-01)
- `--output` output JSON file (default: sim-output.json)
- `--on-time` chance limited-time orders are served on time (default: 0.7)
- `--upgrade-spend` fraction of coins allowed for upgrades per day (default: 0.8)

## Output

The output JSON includes the config, daily season/day keys, and per-player summary stats
(average/min/max coins, rep, level, SXP, bowls served, recipes known, total upgrades).
