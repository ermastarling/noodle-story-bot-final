# Phase 15: NPC Registry + Recipe Discovery Implementation

## Overview
This implementation adds the NPC Registry with archetypes and modifiers, and the Recipe Discovery system as specified in Issue 13, Phase 15.

## Implementation Details

### 1. Database Schema (schema.sql)
Added three new tables for recipe discovery:
- `recipes`: Stores recipe metadata (id, name, tier, ingredients, unlock conditions)
- `recipe_clues`: Stores recipe clues obtained by players
- `recipe_scrolls`: Stores recipe scrolls obtained by players

### 2. Constants (constants.js)
Added discovery system constants:
- `DISCOVERY_HOOKS`: Defines where discovery can occur (serve: true, forage: false, quest_complete: true)
- `DISCOVERY_CHANCE_BASE`: Base chances for discovery (serve: 2%, quest_complete: 10%)
- `CLUE_DUPLICATE_COINS`: Coins awarded for duplicate clues (25)
- `SCROLL_DUPLICATE_TOKEN_CHANCE`: Token chance for duplicate scrolls (50%)
- `SCROLL_DUPLICATE_COINS`: Coins for duplicate scrolls (80)
- `DISCOVERY_TIER_UNLOCK_LEVEL`: Level requirements by tier
- `DISCOVERY_TIER_UNLOCK_REP`: Reputation requirements by tier

### 3. Discovery System (discovery.js)
New module implementing:
- Tier gating based on level and reputation
- Recipe discovery rolls with configurable chances
- NPC-specific discovery bonuses
- Duplicate clue/scroll handling
- Recipe learning from scrolls

### 4. NPC Modifiers (serve.js)
Enhanced computeServeRewards to support all 14 NPC archetypes:

#### Coin Modifiers
- **Rain-Soaked Courier**: +25% coins
- **Traveling Bard**: +10% coins  
- **Festival-Goer**: +25% coins during events
- **Night Market Regular**: Doubles speed bonus

#### SXP Modifiers
- **Forest Spirit**: +10% SXP when recipe has rare topping
- **Retired Captain**: +10 SXP for repeated recipe

#### REP Modifiers
- **Sleepy Traveler**: +5 REP on first serve of day
- **Market Inspector**: +10 REP for Rare+ tier serves
- **Moonlit Spirit**: +15 REP on Epic tier serves
- **Hearth Grandparent**: Grants +2 REP aura for 15 minutes

#### Discovery Modifiers
- **Wandering Scholar**: 10% chance to drop recipe clue
- **Curious Apprentice**: +5% discovery chance for next serve
- **Moonlit Spirit**: Small scroll drop chance on Epic serves
- **Seasonal Herald**: Unlocks cosmetic aura for the day
- **Child with Big Scarf**: 5% cosmetic token chance daily

### 5. Integration (noodle.js)
Updated serve command to:
- Pass recipe and content data to computeServeRewards
- Roll for recipe discovery after each successful serve
- Apply NPC discovery buffs for future serves
- Track daily serves and last recipe served
- Display discovery messages to players
- Handle duplicate discoveries with appropriate rewards

## Testing

### New Tests Added
1. **discovery.test.js** (13 tests)
   - Tier gating validation
   - Discoverable recipe filtering
   - Clue and scroll application
   - Duplicate handling
   - NPC buff application

2. **npc-modifiers.test.js** (13 tests)
   - All 14 NPC modifier behaviors
   - Coin, SXP, and REP modifications
   - Speed bonus calculations
   - Aura effects

### Test Results
- Total tests: 87
- Passing: 82 (including 26 new tests)
- Failing: 5 (pre-existing, unrelated to this PR)

## Usage

### For Players
When serving orders, players may:
1. Receive recipe clues or scrolls based on discovery chances
2. Experience different rewards based on the NPC they're serving
3. Build up discovery bonuses from certain NPCs
4. Learn new recipes instantly from scrolls
5. Earn coins/tokens from duplicate discoveries

### Discovery Chances
Base discovery on serve: 2%
- Boosted by Curious Apprentice: +5%
- Wandering Scholar: 10% clue chance
- Moonlit Spirit: 5% scroll chance on Epic

### Tier Unlocking
Players must meet level AND reputation requirements:
- Rare: Level 5, Rep 25
- Epic: Level 10, Rep 100
- Seasonal: Level 12, Rep 150

## Files Changed
- `src/db/schema.sql`: Added discovery tables
- `src/constants.js`: Added discovery constants
- `src/game/discovery.js`: New module for discovery logic
- `src/game/serve.js`: Enhanced with NPC modifiers
- `src/commands/noodle.js`: Integrated discovery into serve flow
- `test/discovery.test.js`: New test file
- `test/npc-modifiers.test.js`: New test file

## Future Enhancements
- Cosmetic token system (referenced but not fully implemented)
- Event system integration for Festival-Goer
- Quest completion discovery hooks
- Recipe clue viewing and management commands
