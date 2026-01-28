import { nowTs } from "../util/time.js";

export function newServerState(serverId) {
  return {
    server_id: serverId,
    created_at: nowTs(),
    state_rev: 0,
    settings: {},
    season: "spring",
    active_event_id: null,

    market_day: null,
    market_prices: {},
    market_specials: [],
    market_wanted: [],
    market_stock: {},

    orders_day: null,
    order_board: [],

    staff_day: null,
    staff_pool: [],

    audit_log: [],

    npc_affinity: {},
    community_events: {},
    analytics: { visit_log: [] }
  };
}
