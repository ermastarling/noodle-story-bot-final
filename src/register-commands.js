import "dotenv/config";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

// Skip loading native SQLite bindings during command registration to improve startup performance and avoid unnecessary dependencies.
process.env.NOODLE_SKIP_DB = process.env.NOODLE_SKIP_DB || "1";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID || "";

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
  process.exit(1);
}

const LEGACY_TOP_LEVEL_COMMANDS = new Set([
  "forage",
  "cook",
  "serve",
  "orders",
  "accept",
  "cancel",
  "buy",
  "sell",
  "market",
  "profile",
  "garden",
  "fishing",
  "recipes",
  "regulars",
  "quests"
]);

async function cleanupLegacyGlobalCommands(rest) {
  const globalCommands = await rest.get(Routes.applicationCommands(clientId));
  const legacy = (globalCommands || []).filter((cmd) => LEGACY_TOP_LEVEL_COMMANDS.has(cmd.name));
  if (!legacy.length) return 0;

  for (const cmd of legacy) {
    await rest.delete(Routes.applicationCommand(clientId, cmd.id));
  }
  return legacy.length;
}

async function main() {
  const { commands } = await import("./commands/index.js");
  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.map(c => c.data.toJSON());

  console.log(`Registering ${body.length} commands for application ${clientId}`);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`Registered guild commands for ${guildId}`);

    // When registering to a guild, optionally remove stale legacy top-level
    // global commands that can cause duplicate command entries in Discord.
    const shouldCleanupLegacy = String(process.env.NOODLE_CLEANUP_LEGACY_GLOBAL ?? "1") !== "0";
    if (shouldCleanupLegacy) {
      const removed = await cleanupLegacyGlobalCommands(rest);
      if (removed > 0) {
        console.log(`Removed ${removed} legacy global command(s).`);
      }
    }
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log("Registered global commands (Discord can take up to 1 hour to propagate).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
