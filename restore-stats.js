import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "data", "noodlestory.sqlite");
const db = new Database(dbPath);

const serverId = "1460098586824933406"; // Discord server ID

const playersToRestore = [
  { userId: "705521883335885031", bowls: 86, level: 9, rep: 293, coins: 352 },
  { userId: "339621843143098368", bowls: 30, level: 4, rep: 110, coins: 169 },
  { userId: "1460003627409084566", bowls: 1, level: 1, rep: 4, coins: 124 }
];

for (const player of playersToRestore) {
  // Get existing player data
  let row = db.prepare("SELECT data_json, state_rev FROM players WHERE server_id = ? AND user_id = ?").get(serverId, player.userId);
  
  let data;
  let newRev;
  const now = Date.now();
  
  if (!row) {
    // Create a new player with base stats
    console.log(`ℹ️  Creating new player ${player.userId}...`);
    data = {
      coins: player.coins,
      rep: player.rep,
      shop_level: player.level,
      sxp_total: 0,
      sxp_progress: 0,
      known_recipes: ["classic_soy_ramen"],
      inventory: {
        soy_broth: 3,
        wheat_noodles: 3,
        scallions: 2
      },
      orders: [],
      daily_progress: {},
      quests: [],
      buffs: [],
      cooldowns: {},
      clues: [],
      scrolls: [],
      lifetime: {
        bowls_served_total: player.bowls
      },
      tutorial_complete: false,
      tutorial_steps: ["intro_order", "intro_market", "intro_forage", "intro_cook", "intro_serve"],
      tutorial_step_index: 0
    };
    newRev = 1;
    db.prepare("INSERT INTO players (server_id, user_id, schema_version, state_rev, created_at, last_active_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(serverId, player.userId, 1, newRev, now, now, JSON.stringify(data));
  } else {
    // Update existing player
    data = JSON.parse(row.data_json);
    data.coins = player.coins;
    data.rep = player.rep;
    data.shop_level = player.level;
    data.lifetime.bowls_served_total = player.bowls;
    newRev = row.state_rev + 1;
    db.prepare("UPDATE players SET state_rev = ?, data_json = ?, last_active_at = ? WHERE server_id = ? AND user_id = ?")
      .run(newRev, JSON.stringify(data), now, serverId, player.userId);
  }
  
  console.log(`✅ Restored ${player.userId}: ${player.bowls} bowls, level ${player.level}, ${player.rep} rep, ${player.coins}c`);
}

console.log("\n✅ All stats restored!");
process.exit(0);
