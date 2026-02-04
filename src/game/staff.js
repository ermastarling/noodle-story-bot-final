import { loadUpgradesContent } from "../content/index.js";
import { calculateUpgradeEffects } from "./upgrades.js";

const upgradesContent = loadUpgradesContent();

/**
 * Roll a daily staff pool for a server
 * @param {Object} params
 * @param {string} params.serverId
 * @param {Object} params.staffContent - Content from staff.json
 * @returns {Array} Array of staff_ids available today
 */

/**
 * Calculate staff upgrade cost for next level
 * @param {Object} staff - Staff definition from staff.json
 * @param {number} currentLevel - Current level of the staff
 * @returns {number} Cost for next level
 */
export function calculateStaffCost(staff, currentLevel) {
  if (!staff || currentLevel >= staff.max_level) return 0;
  
  const baseCost = staff.base_cost || 100;
  const scaling = staff.cost_scaling || 1.30;
  
  // Cost = baseCost * (scaling ^ currentLevel)
  const cost = Math.floor(baseCost * Math.pow(scaling, currentLevel));
  return cost;
}

/**
 * Level up a staff member
 * @param {Object} player - Player profile
 * @param {string} staffId - Staff ID to level up
 * @param {Object} staffContent - Content from staff.json
 * @returns {Object} { success: boolean, message: string, cost: number, newLevel: number }
 */
export function levelUpStaff(player, staffId, staffContent) {
  const staff = staffContent.staff_members?.[staffId];
  if (!staff) {
    return { success: false, message: "Staff member not found.", cost: 0, newLevel: 0 };
  }
  
  // Ensure staff_levels object exists
  if (!player.staff_levels) player.staff_levels = {};
  
  const currentLevel = player.staff_levels[staffId] || 0;
  
  // Check if at max level
  if (currentLevel >= staff.max_level) {
    return { 
      success: false, 
      message: `${staff.name} is already at max level (${staff.max_level}).`, 
      cost: 0, 
      newLevel: currentLevel 
    };
  }
  
  // Calculate cost
  const cost = calculateStaffCost(staff, currentLevel);
  
  // Check if can afford
  if (player.coins < cost) {
    return { 
      success: false, 
      message: `Not enough coins. Need ${cost} coins.`, 
      cost, 
      newLevel: currentLevel 
    };
  }
  
  // Level up staff
  player.staff_levels[staffId] = currentLevel + 1;
  player.coins -= cost;
  
  return { 
    success: true, 
    message: `Leveled up ${staff.name} to level ${currentLevel + 1} for ${cost} coins!`, 
    cost, 
    newLevel: currentLevel + 1 
  };
}

/**
 * Get maximum staff capacity based on upgrades
 * @param {Object} player - Player profile
 * @returns {number} Maximum staff capacity
 */
export function getMaxStaffCapacity(player) {
  const baseCapacity = 12; // Can level up all 12 staff
  const effects = calculateUpgradeEffects(player, upgradesContent);
  const bonus = Math.floor(effects.staff_capacity || 0);
  return baseCapacity + bonus;
}

/**
 * Calculate total staff effects for a player
 * @param {Object} player - Player profile
 * @param {Object} staffContent - Content from staff.json
 * @returns {Object} Aggregated staff effects
 */
export function calculateStaffEffects(player, staffContent) {
  const effects = {
    ingredient_save_chance: 0,
    double_craft_chance: 0,
    rep_bonus_flat: 0,
    rep_bonus_percent: 0,
    order_quality_bonus: 0,
    cooldown_reduction: 0,
    bowl_capacity_bonus: 0,
    forage_bonus_items: 0,
    market_discount: 0,
    sxp_bonus_percent: 0,
    rare_epic_rep_bonus: 0
  };
  
  if (!player.staff_levels) return effects;
  
  // Get staff effect multiplier from upgrades
  const upgradeEffects = calculateUpgradeEffects(player, upgradesContent);
  const staffMultiplier = 1 + (upgradeEffects.staff_effect_multiplier || 0);
  
  for (const [staffId, level] of Object.entries(player.staff_levels)) {
    if (level <= 0) continue;
    
    const staff = staffContent.staff_members?.[staffId];
    if (!staff || !staff.effects_per_level) continue;
    
    for (const [effectKey, effectPerLevel] of Object.entries(staff.effects_per_level)) {
      if (effects.hasOwnProperty(effectKey)) {
        effects[effectKey] += effectPerLevel * level * staffMultiplier;
      }
    }
  }
  
  return effects;
}

/**
 * Get all staff levels for a player
 * @param {Object} player - Player profile
 * @param {Object} staffContent - Content from staff.json
 * @returns {Array} Array of staff with their current levels
 */
export function getStaffLevels(player, staffContent) {
  if (!player.staff_levels) return [];
  
  return Object.keys(player.staff_levels)
    .filter(staffId => player.staff_levels[staffId] > 0)
    .map(staffId => {
      const staff = staffContent.staff_members?.[staffId];
      const level = player.staff_levels[staffId];
      
      return {
        staffId,
        name: staff?.name || staffId,
        category: staff?.category || "unknown",
        rarity: staff?.rarity || "common",
        level,
        maxLevel: staff?.max_level || 20,
        effects: staff?.effects_per_level || {},
        nextCost: calculateStaffCost(staff, level)
      };
    });
}
