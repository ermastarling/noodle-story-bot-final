import { dayKeyUTC } from "../util/time.js";

export const DAILY_ORDER_MENU_MAX_RECIPES = 10;

export function shouldCommitDailyOrderMenu({ draftSelection = false, confirmed = false } = {}) {
  return !draftSelection || confirmed;
}

export function setDailyOrderMenu(player, recipeIds, {
  availableRecipeIds = [],
  dayKey = dayKeyUTC(),
  serverId = "",
  userId = ""
} = {}) {
  if (!player || typeof player !== "object") throw new Error("Player state is required to set a daily order menu");
  const available = new Set(availableRecipeIds.map((id) => String(id ?? "").trim()).filter(Boolean));
  const unique = [...new Set((recipeIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  const selected = unique.filter((id) => available.has(id));
  if (unique.length !== selected.length) return { ok: false, reason: "unavailable_recipe" };
  if (selected.length < 1) return { ok: false, reason: "menu_empty" };
  if (selected.length > DAILY_ORDER_MENU_MAX_RECIPES) return { ok: false, reason: "menu_too_large" };

  const current = Array.isArray(player.daily_order_menu_recipe_ids) ? player.daily_order_menu_recipe_ids : [];
  if (current.length === selected.length && current.every((id, index) => id === selected[index])) {
    return { ok: true, changed: false, recipeIds: [...current] };
  }
  if (player.daily_order_menu_changed_day === dayKey) {
    return { ok: false, reason: "change_limit_reached" };
  }

  player.daily_order_menu_recipe_ids = selected;
  player.daily_order_menu_changed_day = dayKey;
  if (player.orders_day === dayKey) {
    player.orders_seed = `${serverId}-${userId}-day-${dayKey}-daily-menu-${selected.slice().sort().join("|")}`;
    player.orders_pool_sig = selected.slice().sort().join("|");
  }
  return { ok: true, changed: true, recipeIds: [...selected] };
}
