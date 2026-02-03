import { makeStreamRng, rngBetween, pickWeighted } from "../util/rng.js";
import { dayKeyUTC } from "../util/time.js";

/**
 * Roll a daily staff pool for a server
 * @param {Object} params
 * @param {string} params.serverId
 * @param {Object} params.staffContent - Content from staff.json
 * @returns {Array} Array of staff_ids available today
 */
export function rollDailyStaffPool({ serverId, staffContent }) {
  const dayKey = dayKeyUTC();
  const rng = makeStreamRng({ mode: "seeded", seed: 54321, streamName: "staff_pool", serverId, dayKey });
  
  const poolConfig = staffContent.pool_config || { pool_size: 4, rarity_weights: { common: 60, rare: 30, epic: 10 } };
  const poolSize = poolConfig.pool_size;
  const rarityWeights = poolConfig.rarity_weights;
  
  // Get all available staff
  const allStaff = Object.values(staffContent.staff_members || {});
  if (allStaff.length === 0) return [];
  
  // Group staff by rarity
  const staffByRarity = {
    common: allStaff.filter(s => s.rarity === "common"),
    rare: allStaff.filter(s => s.rarity === "rare"),
    epic: allStaff.filter(s => s.rarity === "epic")
  };
  
  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    // Pick rarity based on weights
    const rarity = pickWeighted(rng, rarityWeights);
    const candidates = staffByRarity[rarity] || [];
    
    if (candidates.length === 0) continue;
    
    // Pick random staff from this rarity
    const idx = Math.floor(rngBetween(rng, 0, candidates.length));
    const staff = candidates[idx];
    
    if (staff && !pool.includes(staff.staff_id)) {
      pool.push(staff.staff_id);
    }
  }
  
  return pool;
}

/**
 * Hire a staff member
 * @param {Object} player - Player profile
 * @param {string} staffId - Staff ID to hire
 * @param {Object} staffContent - Content from staff.json
 * @returns {Object} { success: boolean, message: string, cost: number }
 */
export function hireStaff(player, staffId, staffContent) {
  const staff = staffContent.staff_members?.[staffId];
  if (!staff) {
    return { success: false, message: "Staff member not found.", cost: 0 };
  }
  
  // Check if already hired
  if (player.staff_hired?.[staffId]) {
    return { success: false, message: "Already hired this staff member.", cost: 0 };
  }
  
  // Check if can afford
  const cost = staff.hire_cost || 0;
  if (player.coins < cost) {
    return { success: false, message: `Not enough coins. Need ${cost} coins.`, cost };
  }
  
  // Check staff capacity (based on u_staff_quarters upgrade)
  const maxStaff = getMaxStaffCapacity(player);
  const currentStaff = Object.keys(player.staff_hired || {}).length;
  if (currentStaff >= maxStaff) {
    return { success: false, message: `Staff capacity full (${currentStaff}/${maxStaff}). Upgrade Staff Quarters.`, cost };
  }
  
  // Hire staff
  if (!player.staff_hired) player.staff_hired = {};
  player.staff_hired[staffId] = {
    hired_at: Date.now(),
    total_wages_paid: 0
  };
  player.coins -= cost;
  
  return { success: true, message: `Hired ${staff.name} for ${cost} coins!`, cost };
}

/**
 * Fire a staff member
 * @param {Object} player - Player profile
 * @param {string} staffId - Staff ID to fire
 * @param {Object} staffContent - Content from staff.json
 * @returns {Object} { success: boolean, message: string }
 */
export function fireStaff(player, staffId, staffContent) {
  if (!player.staff_hired?.[staffId]) {
    return { success: false, message: "This staff member is not hired." };
  }
  
  const staff = staffContent.staff_members?.[staffId];
  const staffName = staff?.name || staffId;
  
  delete player.staff_hired[staffId];
  
  return { success: true, message: `Fired ${staffName}.` };
}

/**
 * Get maximum staff capacity based on upgrades
 * @param {Object} player - Player profile
 * @returns {number} Maximum staff capacity
 */
export function getMaxStaffCapacity(player) {
  const baseCapacity = 3;
  const staffQuartersLevel = player.upgrades?.u_staff_quarters || 0;
  // Each level of staff quarters adds 0.5 capacity (so level 2 = +1, level 4 = +2, etc.)
  const bonusCapacity = Math.floor(staffQuartersLevel * 0.5);
  return baseCapacity + bonusCapacity;
}

/**
 * Calculate total staff effects for a player
 * @param {Object} player - Player profile
 * @param {Object} staffContent - Content from staff.json
 * @returns {Object} Aggregated staff effects
 */
export function calculateStaffEffects(player, staffContent) {
  const effects = {
    cooking_speed_bonus: 0,
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
  
  if (!player.staff_hired) return effects;
  
  // Get staff effect multiplier from u_manuals upgrade
  const manualsLevel = player.upgrades?.u_manuals || 0;
  const staffMultiplier = 1 + (manualsLevel * 0.03);
  
  for (const staffId of Object.keys(player.staff_hired)) {
    const staff = staffContent.staff_members?.[staffId];
    if (!staff || !staff.effects) continue;
    
    for (const [effectKey, effectValue] of Object.entries(staff.effects)) {
      if (effects.hasOwnProperty(effectKey)) {
        effects[effectKey] += effectValue * staffMultiplier;
      }
    }
  }
  
  return effects;
}

/**
 * Apply daily wages to all hired staff
 * @param {Object} player - Player profile
 * @param {Object} staffContent - Content from staff.json
 * @returns {Object} { totalWages: number, staffDetails: Array }
 */
export function applyDailyWages(player, staffContent) {
  let totalWages = 0;
  const staffDetails = [];
  
  if (!player.staff_hired) return { totalWages, staffDetails };
  
  for (const staffId of Object.keys(player.staff_hired)) {
    const staff = staffContent.staff_members?.[staffId];
    if (!staff) continue;
    
    const wage = staff.daily_wage || 0;
    totalWages += wage;
    
    if (player.staff_hired[staffId]) {
      player.staff_hired[staffId].total_wages_paid = 
        (player.staff_hired[staffId].total_wages_paid || 0) + wage;
    }
    
    staffDetails.push({ staffId, name: staff.name, wage });
  }
  
  // Deduct wages from player coins (can go negative)
  player.coins -= totalWages;
  
  return { totalWages, staffDetails };
}

/**
 * Get all hired staff for a player
 * @param {Object} player - Player profile
 * @param {Object} staffContent - Content from staff.json
 * @returns {Array} Array of hired staff with details
 */
export function getHiredStaff(player, staffContent) {
  if (!player.staff_hired) return [];
  
  return Object.keys(player.staff_hired).map(staffId => {
    const staff = staffContent.staff_members?.[staffId];
    const hireData = player.staff_hired[staffId];
    
    return {
      staffId,
      name: staff?.name || staffId,
      category: staff?.category || "unknown",
      rarity: staff?.rarity || "common",
      daily_wage: staff?.daily_wage || 0,
      effects: staff?.effects || {},
      hired_at: hireData?.hired_at || 0,
      total_wages_paid: hireData?.total_wages_paid || 0
    };
  });
}
