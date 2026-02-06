import { STARTER_PROFILE, DATA_SCHEMA_VERSION, TUTORIAL_QUESTS } from "../constants.js";
import { nowTs } from "../util/time.js";

export function newPlayerProfile(userId) {
  return {
    user_id: userId,
    created_at: nowTs(),
    schema_version: DATA_SCHEMA_VERSION,
    state_rev: 0,

    shop_level: STARTER_PROFILE.shop_level,
    sxp_total: STARTER_PROFILE.sxp_total,
    sxp_progress: STARTER_PROFILE.sxp_progress,
    rep: STARTER_PROFILE.rep,
    coins: STARTER_PROFILE.coins,

    upgrades: {
      u_prep:0,u_stoves:0,u_ladles:0,u_pantry:0,u_cold_cellar:0,u_secure_crates:0,
      u_seating:0,u_hospitality:0,u_lantern:0,u_decor:0,u_staff_quarters:0,u_manuals:0
    },

    inv_ingredients: { ...STARTER_PROFILE.inv_ingredients },
    inv_bowls: {},

    known_recipes: [...STARTER_PROFILE.known_recipes],
    clues_owned: {},
    scrolls_owned: {},

    staff_levels: {},

    daily: { last_claimed_at: null, streak_days: 0, streak_last_day: null },
    quests: { active: {}, completed: [], claimed: [], daily_day: null, weekly_week: null, monthly_month: null },

    orders: { accepted: {}, seasonal_served_today: 0, epic_served_today: 0 },

    buffs: { rep_aura_expires_at: null, apprentice_bonus_pending: false, last_recipe_served: null, fail_streak: 0 },

    cooldowns: {},

    resilience: { last_rescue_at: null },

    profile: {
      shop_name: "My Noodle Shop",
      tagline: "A tiny shop with a big simmer.",
      featured_badge_id: null,
      badges: [],
      decor_slots: { front:null,counter:null,wall:null,sign:null,frame:null },
      specialization: { active_spec_id: null, chosen_at: null, change_cooldown_expires_at: null, unlocked_spec_ids: [] }
    },

    collections: { completed: [], progress: {} },

    tutorial: { active: true, queue: [...TUTORIAL_QUESTS], completed: [] },

    lifetime: {
      orders_served: 0,
      bowls_served_total: 0,
      limited_time_served: 0,
      perfect_speed_serves: 0,
      coins_earned: 0,
      recipes_cooked: 0,
      npcs_served_unique: 0,
      npc_seen: {},
      coins_tipped_out: 0,
      coins_tipped_in: 0
    },

    social: {
      active_blessing: null,
      last_blessing_at: null
    },

    notifications: {
      pending_pantry_messages: [],
      dm_reminders_opt_out: false,
      last_noodle_channel_id: null,
      last_noodle_guild_id: null
    }
  };
}
