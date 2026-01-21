import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

(async () => {
  // Import discord.js
  const Discord = await import("discord.js").then(m => m.default || m);
  
  const Client = Discord.Client;
  const Intents = Discord.Intents;
  const MessageFlags = Discord.MessageFlags;

  if (!Client || !Intents) {
    console.error("❌ Failed to load discord.js properly");
    console.error("Discord exports:", Object.keys(Discord).slice(0, 20));
    process.exit(1);
  }

  // Now import the rest
  const { commandMap } = await import("./commands/index.js");
  const { startDailyResetScheduler } = await import("./jobs/dailyReset.js");
  const { loadContentBundle, loadSettingsCatalog } = await import("./content/index.js");
  const { openDb, getPlayer } = await import("./db/index.js");
  const { newPlayerProfile } = await import("./game/player.js");
  const { FORAGE_ITEM_IDS } = await import("./game/forage.js");
  const { noodleCommand } = await import("./commands/noodle.js");

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

  const client = new Client({
    intents: [
      Intents.FLAGS.GUILDS,
      Intents.FLAGS.GUILD_MESSAGES,
      Intents.FLAGS.DIRECT_MESSAGES,
      Intents.FLAGS.MESSAGE_CONTENT
    ]
  });

  const db = openDb();
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

  client.once("ready", (c) => {
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

  client.on("interactionCreate", async (interaction) => {
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
          // Defer immediately for buttons/selects (but NOT modals or cook_select which shows a modal)
          if (interaction.isButton?.() || (interaction.isStringSelectMenu?.() && !id.includes("cook_select:"))) {
            try {
              await interaction.deferUpdate();
            } catch (deferErr) {
              // Silently ignore defer errors
            }
          }
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
    const isChatInput = interaction.isChatInputCommand?.() || interaction.isCommand?.();
    if (!isChatInput) return;

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

      try {
        const msg = "Something went a little sideways, try again.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      } catch (replyErr) {
        console.error("❌ Failed to send error reply:", replyErr?.message ?? replyErr);
      }
    }
  });

  client.login(token);
})();
