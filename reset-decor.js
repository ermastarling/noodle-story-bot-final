import { openDb, upsertPlayer } from "./src/db/index.js";
import { loadDecorContent, loadDecorSetsContent } from "./src/content/index.js";
import { ensureDecorState, evaluateDecorSets } from "./src/game/decor.js";

const db = openDb();
if (!db) {
  console.error("Database unavailable. Set NOODLE_SKIP_DB=0 to run this script.");
  process.exit(1);
}

const decorContent = loadDecorContent();
const decorSetsContent = loadDecorSetsContent();
const decorSetIds = new Set((decorSetsContent?.sets ?? []).map((set) => set.set_id));

const rows = db.prepare("SELECT server_id, user_id, data_json, state_rev, schema_version FROM players").all();

let updated = 0;
let totalGranted = 0;
let totalCompleted = 0;

const grantByLevel = (player) => {
  const items = decorContent?.items ?? [];
  const level = Number(player.shop_level || 1);
  const granted = [];

  for (const item of items) {
    if (!item?.item_id) continue;
    if (item.unlock_source !== "shop_level") continue;
    const req = Number(item.unlock_rule?.level || 0);
    if (level < req) continue;
    player.cosmetics_owned[item.item_id] = 1;
    granted.push(item.item_id);
  }

  return granted.length;
};

const tx = db.transaction(() => {
  for (const row of rows) {
    const player = JSON.parse(row.data_json);

    ensureDecorState(player);
    player.cosmetics_owned = {};
    player.profile.decor_slots = { front: null, counter: null, wall: null, sign: null, frame: null };
    player.profile.decor_sets_completed = [];

    if (player.collections?.completed?.length) {
      player.collections.completed = player.collections.completed.filter((id) => !decorSetIds.has(id));
    }
    if (player.collections?.progress) {
      for (const key of Object.keys(player.collections.progress)) {
        if (decorSetIds.has(key)) delete player.collections.progress[key];
      }
    }

    const granted = grantByLevel(player);
    const completed = evaluateDecorSets(player, decorContent, decorSetsContent);

    totalGranted += granted;
    totalCompleted += completed.length;

    upsertPlayer(db, row.server_id, row.user_id, player, row.state_rev, row.schema_version ?? 1);
    updated += 1;
  }
});

tx();

console.log(`Updated ${updated} players.`);
console.log(`Granted ${totalGranted} level-based decor items.`);
console.log(`Completed ${totalCompleted} decor sets.`);
process.exit(0);
