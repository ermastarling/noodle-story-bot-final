# Noodle Story Bot

Cozy Discord bot game where players run a noodle shop, serve NPCs, unlock recipes, and grow their shop through upgrades, staff, and seasonal content.

## Highlights

- NPC order board with rarity tiers, seasonal recipes, and limited-time orders
- Cooking system with quality outcomes and rewards
- Recipe discovery via clues and scrolls
- Quests, daily rewards, and collections
- Shop upgrades, staff, decor, and specializations
- Social features: parties, tips, blessings, and leaderboards

## Requirements

- Node.js 18+ (ESM)
- Discord bot token with guild and message intents

## Quick Start

1) Install dependencies

```
npm install
```

2) Create a .env file

```
DISCORD_TOKEN=your_token_here
```

3) Register commands

```
npm run register:dev
```

4) Run the bot

```
npm run dev
```

## Scripts

- npm run dev: run the bot in watch mode
- npm run start: run the bot once
- npm run register:dev: register slash commands (dev)
- npm run register:prod: register slash commands (prod)
- npm run test: run tests
- npm run sim: run the simulation harness

## Simulation Harness

The simulation helps stress-test the economy and progression without Discord. It generates daily orders, serves them, applies rewards, discovery, and upgrades, then writes a JSON report.

```
npm run sim -- --days=30 --players=100 --orders-per-day=8 --seed=1337 --output=sim-output.json
```

See SIMULATION.md for full options.

## Data Notes

- SQLite data is stored in data/ by default.
- WAL/SHM files are transient and can be regenerated.

## Project Structure

- src/: bot, game logic, infra, and jobs
- content/: game content (recipes, NPCs, upgrades, etc.)
- test/: automated tests