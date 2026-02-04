# Phase 10: Inventory Capacity & Spoilage Implementation

**Issue:** #09 — Phase 10: Inventory Capacity & Spoilage  
**Status:** ✅ Complete  
**Date:** 2026-02-04

---

## Overview

This phase implements a comprehensive inventory management system with capacity limits and spoilage mechanics. The system makes storage upgrades meaningful by enforcing pantry capacity limits and adding decay pressure through time-based spoilage.

---

## Files Added

### 1. `src/game/inventory.js`
Complete inventory management system with:
- **Capacity Management**: Calculate and enforce limits for ingredients and bowls
- **Overflow Handling**: Configurable modes (block, truncate, allow)
- **Inventory Operations**: Add, remove, and check items with capacity validation
- **Status Reporting**: Get detailed inventory status information

**Key Constants:**
```javascript
ING_STACK_CAP_BASE = 40           // Base capacity per ingredient type
ING_STACK_CAP_PER_UPGRADE = 5     // Bonus per pantry upgrade level
BOWL_STACK_CAP_BASE = 10          // Fixed capacity per bowl type
OVERFLOW_MODE = "block"           // Default overflow behavior
```

**Main Functions:**
- `getIngredientStackCapacity(player)` - Calculate capacity with upgrades
- `addIngredientsToInventory(player, items, mode)` - Add with capacity checks
- `removeIngredientsFromInventory(player, items)` - Remove items safely
- `hasIngredients(player, required)` - Check if player has items
- `addBowlToInventory(player, key, data, qty, mode)` - Bowl management
- `getInventoryStatus(player)` - Get comprehensive status

### 2. `content/spoilage.rules.json`
Configuration file documenting spoilage rules:
- **Default Settings**: 5% base chance per hour
- **Tier Modifiers**: Rarer items spoil slower
  - Common: 1.0x (normal rate)
  - Rare: 0.8x (20% slower)
  - Epic: 0.6x (40% slower)
  - Seasonal: 0.5x (50% slower)
- **Cold Storage**: u_cold_cellar reduces spoilage by 1% per level (max 50%)
- **Bowl Protection**: Bowls don't spoil by default
- **Capacity Rules**: Documents the capacity formulas

### 3. `test/inventory.test.js`
Comprehensive test suite with 23 tests covering:
- Capacity calculations with and without upgrades
- Add/remove operations in all modes
- Overflow handling (block, truncate, allow)
- Bowl inventory management
- Status and counting functions

**Test Results:** ✅ All 23 tests passing

---

## Files Modified

### 1. `src/game/forage.js`
**Changes:**
- Import `addIngredientsToInventory` from inventory module
- Updated `applyDropsToInventory()` to use new capacity system
- Returns result object with success status and blocked items

**Impact:** Forage now respects capacity limits

### 2. `src/commands/noodle.js`
**Changes:**
- Import `addIngredientsToInventory` from inventory module
- **Forage Command**: Shows warning when items can't be collected due to capacity
- **Buy Command**: Blocks purchases that would exceed capacity
- **Shared Order Purchases**: Both variants check capacity before allowing purchase

**User Experience:**
```
⚠️ **Pantry Full!** Could not collect: 2× Scallions, 1× Carrots
Upgrade your Pantry to increase capacity.
```

### 3. `src/game/timeCatchup.js`
**Changes:**
- Enhanced `getSpoilageReduction()` function with tier-based calculation
- Cold cellar provides up to 50% reduction (1% per level)
- Tier modifiers reduce spoilage for rarer items
- Formula: `spoilChance = baseChance × tierMultiplier × (1 - coldStorageReduction)`

**Impact:** More sophisticated spoilage system that rewards upgrades

---

## System Design

### Capacity Formula

**Ingredients:**
```
Per-Item Capacity = 40 + (5 × u_pantry level)

Examples:
- Level 0: 40 items per type
- Level 5: 65 items per type
- Level 10: 90 items per type
- Level 50: 290 items per type
```

**Bowls:**
```
Per-Bowl Capacity = 10 (fixed)
```

### Overflow Modes

1. **"block"** (default): Prevents adding items that exceed capacity
2. **"truncate"**: Adds items up to capacity, discards overflow
3. **"allow"**: Ignores capacity limits (for special cases)

### Spoilage Calculation

For each tick (hourly by default):
```javascript
effectiveChance = baseChance × tierMultiplier × (1 - coldStorageReduction)

Where:
- baseChance = 0.05 (5% per hour, configurable)
- tierMultiplier = 1.0 / 0.8 / 0.6 / 0.5 (common/rare/epic/seasonal)
- coldStorageReduction = min(0.5, coldCellarLevel × 0.01)
```

**Example Calculations:**

Common fresh ingredient, no upgrades:
```
chance = 0.05 × 1.0 × 1.0 = 5% per hour
```

Rare fresh ingredient, level 20 cold cellar:
```
chance = 0.05 × 0.8 × (1 - 0.20) = 3.2% per hour
```

Epic fresh ingredient, level 50 cold cellar:
```
chance = 0.05 × 0.6 × (1 - 0.50) = 1.5% per hour
```

---

## Integration Points

### 1. Forage System
- Checks capacity before adding foraged items
- Returns result with `added` and `blocked` items
- Shows warning message for blocked items
- Encourages pantry upgrades

### 2. Market System
- Single purchases check capacity before deducting coins
- Multi-item purchases validate entire order
- Shared order purchases also enforce limits
- Clear error messages guide players to upgrade

### 3. Time Catchup
- Applies spoilage during offline periods
- Respects upgrade effects (cold cellar)
- Considers item tier for spoilage rate
- Shows summary of spoiled items on login

---

## Acceptance Criteria

✅ **Pantry caps enforced**
- Base 40 capacity per ingredient type
- Increases by 5 per pantry upgrade level
- Blocks additions when capacity reached

✅ **Spoilage applies over time**
- Hourly tick evaluation (configurable)
- Only affects forage-only (spoilable) items
- Deterministic based on player/item/tick
- Shows clear feedback to players

✅ **Cold storage upgrades mitigate spoilage**
- Each level reduces spoilage by 1%
- Max 50% reduction at level 50
- Applies to fresh ingredients
- Combines with tier modifiers

✅ **Additional Features**
- Bowl capacity system (10 per type)
- Comprehensive test coverage
- Clear user feedback
- No breaking changes

---

## Testing Summary

### Unit Tests
- ✅ 23 inventory tests - All passing
- ✅ 17 timeCatchup tests - All passing
- ✅ 1 smoke test - Passing

### Integration Tests
- ✅ Forage with capacity limits
- ✅ Market purchases with capacity checks
- ✅ Shared orders with capacity validation
- ✅ Spoilage during offline periods

### Security
- ✅ CodeQL scan - 0 vulnerabilities found
- ✅ No SQL injection risks
- ✅ No data loss scenarios
- ✅ Deterministic spoilage (no RNG exploits)

---

## Usage Examples

### Example 1: Forage with Full Pantry
```
/noodle forage

You wander into the nearby grove and return with:
• 2× Scallions
• 1× Carrots

⚠️ **Pantry Full!** Could not collect: 1× Wild Greens
Upgrade your Pantry to increase capacity.
```

### Example 2: Market Purchase Blocked
```
/noodle buy item:soy_broth qty:10

⚠️ **Pantry Full!** Cannot store 10× Soy Broth.
Upgrade your Pantry to increase capacity.
```

### Example 3: Spoilage on Login
```
🕐 While you were away, some ingredients spoiled: 3× Scallions, 1× Carrots
(24 ticks evaluated)
```

---

## Future Enhancements

Potential improvements for future phases:

1. **Bowl Capacity Upgrades**: Allow u_secure_crates to increase bowl capacity
2. **Partial Spoilage**: Allow items to "degrade" before fully spoiling
3. **Preservation Items**: Special items that prevent spoilage
4. **Capacity UI**: Show capacity bars in inventory display
5. **Spoilage Notifications**: Daily summary of items at risk
6. **Auto-Sell**: Option to auto-sell excess items before they spoil

---

## Configuration

Server admins can configure spoilage via settings:

```javascript
SPOILAGE_ENABLED: true/false             // Enable/disable system
SPOILAGE_APPLY_ON_LOGIN: true/false      // Apply missed ticks
SPOILAGE_TICK_HOURS: 1                   // Hours per tick
SPOILAGE_BASE_CHANCE: 0.05               // 5% base chance
SPOILAGE_MAX_CATCHUP_TICKS: 24           // Cap login catch-up
```

---

## Maintenance Notes

### Adding New Spoilable Items
1. Set `spoilable: true` in `content/bundle.v1.json`
2. Add appropriate tags (e.g., "fresh") for cold cellar protection
3. Set tier for automatic spoilage rate adjustment

### Modifying Capacity
1. Adjust constants in `src/game/inventory.js`
2. Update `content/spoilage.rules.json` documentation
3. Consider impact on existing player inventories

### Changing Spoilage Rates
1. Modify settings in `content/settings.catalog.json`
2. Update tier multipliers in `timeCatchup.js` if needed
3. Test with various upgrade levels

---

## Technical Debt / Known Issues

1. **Market Purchase Duplication**: Two similar code blocks for handling market purchases (with/without locks). Intentionally not refactored to avoid complexity with lock management.

2. **Backward Compatibility**: Old saves with items exceeding capacity are grandfathered in until next modification.

3. **Performance**: Spoilage calculation is O(items × ticks). Capped at 24 ticks per login to prevent performance issues.

---

## Credits

**Implementation Date:** February 4, 2026  
**Issue Tracker:** #09 — Phase 10: Inventory Capacity & Spoilage  
**Related Systems:** Upgrades (Phase 3), Time Catchup (Phase C), Market (Phase 2)

---

## Summary

This implementation successfully adds meaningful constraints to the game through inventory capacity limits and spoilage mechanics. Players are incentivized to:

1. **Upgrade Pantry** - Increase storage capacity for more ingredients
2. **Upgrade Cold Cellar** - Preserve fresh ingredients longer
3. **Play Regularly** - Avoid spoilage from extended absences
4. **Manage Resources** - Balance hoarding vs. using ingredients

The system integrates seamlessly with existing mechanics while maintaining the cozy, non-punishing nature of the game. Spoilage is gradual and mitigated by upgrades, never catastrophic.
