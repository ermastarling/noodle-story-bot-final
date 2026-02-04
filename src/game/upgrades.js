/**
 * Calculate upgrade cost for next level
 * @param {Object} upgrade - Upgrade definition from upgrades.json
 * @param {number} currentLevel - Current level of the upgrade
 * @returns {number} Cost for next level
 */
export function calculateUpgradeCost(upgrade, currentLevel) {
  if (!upgrade || currentLevel >= upgrade.max_level) return 0;
  
  const baseCost = upgrade.base_cost || 100;
  const scaling = upgrade.cost_scaling || 1.30;
  
  // Cost = baseCost * (scaling ^ currentLevel)
  const cost = Math.floor(baseCost * Math.pow(scaling, currentLevel));
  return cost;
}

/**
 * Purchase an upgrade level
 * @param {Object} player - Player profile
 * @param {string} upgradeId - Upgrade ID (e.g., "u_prep")
 * @param {Object} upgradesContent - Content from upgrades.json
 * @returns {Object} { success: boolean, message: string, cost: number, newLevel: number }
 */
export function purchaseUpgrade(player, upgradeId, upgradesContent) {
  const upgrade = upgradesContent.upgrades?.[upgradeId];
  if (!upgrade) {
    return { success: false, message: "Upgrade not found.", cost: 0, newLevel: 0 };
  }
  
  // Ensure upgrades object exists
  if (!player.upgrades) player.upgrades = {};
  
  const currentLevel = player.upgrades[upgradeId] || 0;
  
  // Check if at max level
  if (currentLevel >= upgrade.max_level) {
    return { 
      success: false, 
      message: `${upgrade.name} is already at max level (${upgrade.max_level}).`, 
      cost: 0, 
      newLevel: currentLevel 
    };
  }
  
  // Calculate cost
  const cost = calculateUpgradeCost(upgrade, currentLevel);
  
  // Check if can afford
  if (player.coins < cost) {
    return { 
      success: false, 
      message: `Not enough coins. Need ${cost} coins.`, 
      cost, 
      newLevel: currentLevel 
    };
  }
  
  // Purchase upgrade
  player.upgrades[upgradeId] = currentLevel + 1;
  player.coins -= cost;
  
  return { 
    success: true, 
    message: `Upgraded ${upgrade.name} to level ${currentLevel + 1} for ${cost} coins!`, 
    cost, 
    newLevel: currentLevel + 1 
  };
}

/**
 * Calculate total upgrade effects for a player
 * @param {Object} player - Player profile
 * @param {Object} upgradesContent - Content from upgrades.json
 * @returns {Object} Aggregated upgrade effects
 */
export function calculateUpgradeEffects(player, upgradesContent) {
  const effects = {
    ingredient_save_chance: 0,
    bowl_capacity_bonus: 0,
    ingredient_capacity: 0,
    spoilage_reduction: 0,
    bowl_storage_capacity: 0,
    rep_bonus_flat: 0,
    rep_bonus_percent: 0,
    order_quality_bonus: 0,
    npc_variety_bonus: 0,
    staff_capacity: 0,
    staff_effect_multiplier: 0
  };
  
  if (!player.upgrades) return effects;
  
  for (const [upgradeId, level] of Object.entries(player.upgrades)) {
    if (level <= 0) continue;
    
    const upgrade = upgradesContent.upgrades?.[upgradeId];
    if (!upgrade || !upgrade.effects_per_level) continue;
    
    for (const [effectKey, effectPerLevel] of Object.entries(upgrade.effects_per_level)) {
      if (effects.hasOwnProperty(effectKey)) {
        effects[effectKey] += effectPerLevel * level;
      }
    }
  }
  
  return effects;
}

/**
 * Get combined effects from both upgrades and staff
 * @param {Object} player - Player profile
 * @param {Object} upgradesContent - Content from upgrades.json
 * @param {Object} staffContent - Content from staff.json (optional)
 * @param {Function} calculateStaffEffects - Function to calculate staff effects (optional)
 * @returns {Object} Combined effects
 */
export function calculateCombinedEffects(player, upgradesContent, staffContent = null, calculateStaffEffects = null) {
  const upgradeEffects = calculateUpgradeEffects(player, upgradesContent);
  
  // If staff calculation is not provided, just return upgrade effects
  if (!staffContent || !calculateStaffEffects) {
    return upgradeEffects;
  }
  
  const staffEffects = calculateStaffEffects(player, staffContent);
  
  // Combine effects additively
  const combined = { ...upgradeEffects };
  for (const [key, value] of Object.entries(staffEffects)) {
    if (combined.hasOwnProperty(key)) {
      combined[key] += value;
    } else {
      combined[key] = value;
    }
  }
  
  return combined;
}

/**
 * Get all upgrades with their current levels and next costs
 * @param {Object} player - Player profile
 * @param {Object} upgradesContent - Content from upgrades.json
 * @returns {Object} Upgrades by category
 */
export function getUpgradesByCategory(player, upgradesContent) {
  const categories = upgradesContent.upgrade_categories || {};
  const result = {};
  
  for (const [categoryId, categoryInfo] of Object.entries(categories)) {
    result[categoryId] = {
      ...categoryInfo,
      upgrades: []
    };
  }
  
  for (const [upgradeId, upgrade] of Object.entries(upgradesContent.upgrades || {})) {
    const currentLevel = player.upgrades?.[upgradeId] || 0;
    const nextCost = calculateUpgradeCost(upgrade, currentLevel);
    const isMaxed = currentLevel >= upgrade.max_level;
    
    const upgradeInfo = {
      upgradeId,
      name: upgrade.name,
      description: upgrade.description,
      currentLevel,
      maxLevel: upgrade.max_level,
      nextCost,
      isMaxed,
      effects: upgrade.effects_per_level
    };
    
    const category = upgrade.category || "other";
    if (result[category]) {
      result[category].upgrades.push(upgradeInfo);
    } else {
      if (!result.other) {
        result.other = { display_name: "Other", icon: "📋", upgrades: [] };
      }
      result.other.upgrades.push(upgradeInfo);
    }
  }
  
  return result;
}

/**
 * Apply upgrade effects to specific game calculations
 * These helper functions make it easy to apply upgrade bonuses in other game systems
 */

/**
 * Check if ingredient is saved (not consumed)
 * @param {Object} effects - Combined effects object
 * @param {Function} rng - Random number generator
 * @returns {boolean} Whether ingredient is saved
 */
export function rollIngredientSave(effects, rng) {
  const chance = effects.ingredient_save_chance || 0;
  return rng() < chance;
}

/**
 * Check if double craft occurs
 * @param {Object} effects - Combined effects object
 * @param {Function} rng - Random number generator
 * @returns {boolean} Whether double craft occurs
 */
export function rollDoubleCraft(effects, rng) {
  const chance = effects.double_craft_chance || 0;
  return rng() < chance;
}

/**
 * Apply reputation bonuses
 * @param {number} baseRep - Base reputation value
 * @param {Object} effects - Combined effects object
 * @param {string} tier - Recipe tier (for rare_epic_rep_bonus)
 * @returns {number} Modified reputation
 */
export function applyReputationBonus(baseRep, effects, tier = null) {
  let rep = baseRep;
  
  // Add flat bonus
  rep += effects.rep_bonus_flat || 0;
  
  // Add rare/epic bonus if applicable
  if (tier === "rare" || tier === "epic") {
    rep += effects.rare_epic_rep_bonus || 0;
  }
  
  // Apply percentage bonus
  const percentBonus = effects.rep_bonus_percent || 0;
  rep = rep * (1 + percentBonus);
  
  return Math.floor(rep);
}

/**
 * Apply cooldown reduction
 * @param {number} baseCooldown - Base cooldown in milliseconds
 * @param {Object} effects - Combined effects object
 * @returns {number} Modified cooldown
 */
export function applyCooldownReduction(baseCooldown, effects) {
  const reduction = effects.cooldown_reduction || 0;
  return Math.floor(baseCooldown * (1 - reduction));
}

/**
 * Get total bowl capacity
 * @param {number} baseCapacity - Base capacity
 * @param {Object} effects - Combined effects object
 * @returns {number} Total capacity
 */
export function getTotalBowlCapacity(baseCapacity, effects) {
  return baseCapacity + (effects.bowl_capacity_bonus || 0);
}

/**
 * Apply market discount
 * @param {number} basePrice - Base market price
 * @param {Object} effects - Combined effects object
 * @returns {number} Discounted price
 */
export function applyMarketDiscount(basePrice, effects) {
  const discount = effects.market_discount || 0;
  return Math.floor(basePrice * (1 - discount));
}
