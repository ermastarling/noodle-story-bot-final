# Shared Orders Implementation Summary

## Overview
Implemented a complete shared order system for party cooperation in Noodle Story. This feature allows party leaders to create shared recipes that multiple party members can contribute ingredients to, with significant rewards upon completion.

## Key Features

### 1. Minimum Servings Requirement
- **Minimum**: 5 servings (enforced via `SHARED_ORDER_MIN_SERVINGS`)
- **Purpose**: Encourages meaningful party cooperation
- **Validation**: Modal submission validates input and rejects values below 5

### 2. Reward Structure
Per-serving rewards distributed equally to all contributors:
- **Coins**: 120c per serving
- **Reputation (REP)**: 6 REP per serving
- **Skill Experience (SXP)**: 15 SXP per serving
- **Automatic Level Up**: SXP awards trigger `applySxpLevelUp()` for potential shop level increases

### 3. Shared Order Workflow

#### Party Leader: Create Shared Order
1. View party menu → Click **🍜 Shared Order** button
2. Modal prompt asks for:
   - **Recipe ID**: Recipe identifier (e.g., `classic_soy_ramen`)
   - **Servings**: Number of servings (minimum 5)
3. Recipe validation confirms existence in content bundle
4. System creates order and displays:
   - Recipe name and servings
   - Full ingredient list with quantities needed
   - How-it-works explanation

#### Party Members: Contribute Ingredients
1. From party menu → Click **🍜 Shared Order** → **Contribute** button
2. Modal prompt asks for:
   - **Ingredient ID**: Ingredient identifier (e.g., `scallions`)
   - **Quantity**: Amount contributed
3. Contribution recorded and attributed to contributor
4. Contribution points updated in party member profile

#### Party Leader: Complete Order
1. From party menu → Click **Shared Order Complete** button
2. Confirmation prompt (prevents accidental completion)
3. System calculates and distributes rewards:
   - Fetches all contributions
   - Counts unique contributors
   - Calculates per-contributor rewards
   - Locks and updates each contributor's player state
4. Displays completion embed with:
   - Recipe name and total servings
   - Number of contributors
   - Reward breakdown per contributor

## Technical Implementation

### Database Schema
Uses existing SQLite tables:
- `shared_orders`: Stores order ID, party ID, recipe ID, status, timestamps
- `shared_order_contributions`: Tracks individual ingredient contributions
- `party_members`: Updates `contribution_points` field

### UI Components

#### Party Action Row
Added **🍜 Shared Order** button (leader-only):
```javascript
if (isPartyLeader) {
  components.push(
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:shared_order:${userId}`)
      .setLabel("🍜 Shared Order")
      .setStyle(ButtonStyle.Primary)
  );
}
```

#### Modal Handlers
1. **Create Shared Order Modal**
   - `customId`: `noodle-social:modal:create_shared_order:{userId}`
   - Fields: `recipe_id`, `servings`
   - Validation: Minimum servings check, recipe lookup

2. **Contribute to Order Modal**
   - `customId`: `noodle-social:modal:contribute_shared_order:{userId}`
   - Fields: `ingredient_id`, `quantity`
   - Validation: Ingredient lookup, quantity > 0

#### Action Handlers
1. **shared_order**: Opens creation modal (leader only)
2. **shared_order_contribute**: Opens contribution modal (all members)
3. **shared_order_complete**: Confirmation prompt (leader only)
4. **shared_order_confirm_complete**: Execute completion (leader only)
5. **shared_order_cancel_complete**: Cancel completion

### Helper Functions

#### New Function in `src/game/social.js`
```javascript
export function getActiveSharedOrderByParty(db, partyId) {
  return db.prepare("SELECT * FROM shared_orders WHERE party_id = ? AND status = 'active' LIMIT 1").get(partyId);
}
```

### Constants in `src/commands/noodleSocial.js`
```javascript
const SHARED_ORDER_MIN_SERVINGS = 5;
const SHARED_ORDER_REWARD = {
  coinsPerServing: 120,
  repPerServing: 6,
  sxpPerServing: 15
};
```

### Content Bundle Integration
- Recipe lookup via `content.recipes[recipeId]`
- Ingredient lookup via `content.items[ingredientId]`
- Automatic quantity calculation: `ing.qty * servings`

## Error Handling

### Validation Checks
1. **Party membership**: User must be in an active party
2. **Leadership**: Only party leader can create/complete orders
3. **Duplicate orders**: Cannot have multiple active orders per party
4. **Recipe existence**: Recipe must exist in content bundle
5. **Ingredient existence**: Ingredient must exist in content bundle
6. **Servings minimum**: Cannot create order with < 5 servings
7. **Quantity validation**: Contributions must be ≥ 1

### User-Friendly Error Messages
- Ephemeral responses for UI-only users
- Clear message explaining restrictions
- Guidance on what actions are available

## Concurrency & Locking

### Distributed Lock Pattern
All state mutations use `withLock()`:
```javascript
const ownerLock = `discord:${interaction.id}`;
return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
  // ... state mutations
});
```

### Multi-User Locking
When distributing rewards, each contributor is locked individually:
```javascript
for (const contributorId of contributorIds) {
  await withLock(db, `lock:user:${contributorId}`, ownerLock, 8000, async () => {
    // ... update player state
  });
}
```

## Testing
- No syntax errors in implementation
- Integrated with existing party system
- Tested reward calculation logic
- Validated modal submission handling
- Confirmed error handling for edge cases

## Future Enhancements
- Visual progress tracker showing % of ingredients collected
- Automatic order completion when all ingredients gathered
- Order history and statistics per party
- Leaderboard for shared orders by party
- Special events with bonus rewards for shared orders
- Time-limited shared orders with multiplier rewards

## Files Modified
1. **src/commands/noodleSocial.js**
   - Added shared order button to party action row
   - Implemented modals for creation and contribution
   - Added all button action handlers
   - Integrated content bundle for recipe/ingredient lookup

2. **src/game/social.js**
   - Added `getActiveSharedOrderByParty()` function
   - Integrated with existing `createSharedOrder()`, `contributeToSharedOrder()`, etc.

## Commit
Committed as: `feat: implement shared orders with contributions and rewards`
