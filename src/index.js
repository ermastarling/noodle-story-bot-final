import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import discordPkg from "discord.js";

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  MessageFlags
} = discordPkg;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});
import { commandMap } from "./commands/index.js";
import { startDailyResetScheduler } from "./jobs/dailyReset.js";
import { loadContentBundle, loadSettingsCatalog } from "./content/index.js";
import { openDb, getPlayer } from "./db/index.js";
import { newPlayerProfile } from "./game/player.js";
import { FORAGE_ITEM_IDS } from "./game/forage.js";
import { noodleCommand } from "./commands/noodle.js";

/* ------------------------------------------------------------------ */
/*  Boot + diagnostics                                                 */
/* ------------------------------------------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CWD = process.cwd();

const LOG_PATH = path.join(CWD, "command-errors.log");
const BOOT_PATH = path.join(CWD, "boot-ok.log");

console.log("✅ BOOTING FILE:", __filename);
console.log("✅ CWD:", CWD);

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason?.stack ?? reason);
});

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err?.stack ?? err);
});

/* ------------------------------------------------------------------ */
/*  Client setup                                                       */
/* ------------------------------------------------------------------ */

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ Missing DISCORD_TOKEN in .env");
  process.exit(1);
}

const db = openDb();

// Load content ONCE
const content = loadContentBundle(1);
const settingsCatalog = loadSettingsCatalog();

function getUnlockedIngredientIds(player, content) {
  const out = new Set();
  const known = Array.isArray(player?.known_recipes) ? player.known_recipes : [];

  for (const recipeId of known) {
    const r = content.recipes?.[recipeId];
    if (!r) continue;

    for (const ing of (r.ingredients ?? [])) {
      if (ing?.item_id) out.add(ing.item_id);
    }
  }

  return out;
}

async function getKnownServerIds() {
  return [...client.guilds.cache.keys()];
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);

  try {
    fs.writeFileSync(
      BOOT_PATH,
      `Boot OK\nTime: ${new Date().toISOString()}\nFile: ${__filename}\nCWD: ${CWD}\n`
    );
    console.log("✅ Boot marker written:", BOOT_PATH);
  } catch (e) {
    console.error("❌ Failed to write boot marker:", e?.stack ?? e);
  }

  startDailyResetScheduler(getKnownServerIds);
});

/* ------------------------------------------------------------------ */
/*  Interaction handling                                               */
/* ------------------------------------------------------------------ */

client.on(Events.InteractionCreate, async (interaction) => {
  /* ---------- AUTOCOMPLETE ---------- */
  if (interaction.isAutocomplete()) {
    try {
      if (interaction.commandName !== "noodle") return;

      const sub = interaction.options.getSubcommand(false);
      const focused = interaction.options.getFocused(true);
      const q = String(focused?.value ?? "").toLowerCase();

      // ✅ Cook autocomplete (known recipes only)
      if (sub === "cook" && focused.name === "recipe") {
        const serverId = interaction.guildId;
        const userId = interaction.user.id;
        if (!serverId) return interaction.respond([]);

        const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
        const known = Array.isArray(p.known_recipes) ? p.known_recipes : [];

        const results = known
          .map((id) => {
            const r = content.recipes?.[id];
            const name = r?.name ?? id;
            return { id, name };
          })
          .filter(x =>
            x.id.toLowerCase().includes(q) ||
            x.name.toLowerCase().includes(q)
          )
          .slice(0, 25)
          .map(x => ({
            name: String(x.name).slice(0, 100),
            value: String(x.id).slice(0, 100)
          }));

        return interaction.respond(results);
      }

      // ✅ Market autocomplete (buy/sell) — only ingredients used by unlocked recipes
      if ((sub === "buy" || sub === "sell") && focused.name === "item") {
        const serverId = interaction.guildId;
        const userId = interaction.user.id;
        if (!serverId) return interaction.respond([]);

        const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
        const allowed = getUnlockedIngredientIds(p, content);

        const results = Object.values(content.items ?? {})
          .filter(it => it && it.item_id && (it.acquisition === "market" || it.base_price))
          .filter(it => allowed.has(it.item_id))
          .filter(it => it.name?.toLowerCase().includes(q) || it.item_id.toLowerCase().includes(q))
          .slice(0, 25)
          .map(it => ({
            name: String(it.name ?? it.item_id).slice(0, 100),
            value: String(it.item_id).slice(0, 100)
          }));

        return interaction.respond(results);
      }

      // ✅ Forage autocomplete (unlocked forage items only)
      if (sub === "forage" && focused.name === "item") {
        const serverId = interaction.guildId;
        const userId = interaction.user.id;
        if (!serverId) return interaction.respond([]);

        const p = getPlayer(db, serverId, userId) ?? newPlayerProfile(userId);
        const allowed = getUnlockedIngredientIds(p, content);
        const allowedForage = (FORAGE_ITEM_IDS ?? []).filter(id => allowed.has(id));

        const results = allowedForage
          .map(id => ({ id, name: content.items?.[id]?.name ?? id }))
          .filter(x =>
            x.id.toLowerCase().includes(q) ||
            x.name.toLowerCase().includes(q)
          )
          .slice(0, 25)
          .map(x => ({
            name: String(x.name).slice(0, 100),
            value: String(x.id).slice(0, 100)
          }));

        return interaction.respond(results);
      }

      return interaction.respond([]);
    } catch (e) {
      console.error("AUTOCOMPLETE ERROR:", e?.stack ?? e);
      try { return interaction.respond([]); } catch { return; }
    }
  }

  /* ---------- NOODLE UI COMPONENTS ---------- */
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.() || interaction.isModalSubmit?.()) {
    try {
      const id = interaction.customId || "";
      if (id.startsWith("noodle:")) {
        return noodleCommand.handleComponent(interaction);
      }
    } catch (e) {
      console.error("NOODLE COMPONENT ERROR:", e?.stack ?? e);
      try {
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({ content: "Something went a little sideways, try again.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
      return;
    }
  }

  /* ---------- SLASH COMMANDS ---------- */
  if (!interaction.isChatInputCommand()) return;

  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (e) {
    const detail = e?.stack ?? String(e);
    console.error("COMMAND ERROR:", detail);

    try {
      fs.appendFileSync(LOG_PATH, `\n[${new Date().toISOString()}]\n${detail}\n`);
      console.log("🧾 Error written to:", LOG_PATH);
    } catch (err) {
      console.error("❌ Failed to write error log:", err?.stack ?? err);
    }

    const msg = "Something went a little sideways, try again.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
  }
});

/* ------------------------------------------------------------------ */

client.login(token);
/* ------------------------------------------------------------------ */
