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

function compareSnowflakeDesc(a, b) {
  const aId = BigInt(String(a?.id ?? "0"));
  const bId = BigInt(String(b?.id ?? "0"));
  if (aId === bId) return 0;
  return aId > bId ? -1 : 1;
}

async function cleanupDuplicateCommands(commands, deleteCommandById) {
  const byName = new Map();
  for (const cmd of commands || []) {
    const key = String(cmd?.name ?? "").trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(cmd);
  }

  let removed = 0;
  for (const group of byName.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(compareSnowflakeDesc);
    const stale = sorted.slice(1);
    for (const cmd of stale) {
      await deleteCommandById(cmd.id);
      removed += 1;
    }
  }

  return removed;
}

async function cleanupLegacyCommands(commands, deleteCommandById) {
  const legacy = (commands || []).filter((cmd) => LEGACY_TOP_LEVEL_COMMANDS.has(cmd.name));
  for (const cmd of legacy) {
    await deleteCommandById(cmd.id);
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

    const guildCommands = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
    const removedGuildDuplicates = await cleanupDuplicateCommands(
      guildCommands,
      (commandId) => rest.delete(Routes.applicationGuildCommand(clientId, guildId, commandId))
    );
    if (removedGuildDuplicates > 0) {
      console.log(`Removed ${removedGuildDuplicates} duplicate guild command(s).`);
    }

    // When registering to a guild, optionally remove stale legacy top-level
    // global commands that can cause duplicate command entries in Discord.
    const shouldCleanupLegacy = String(process.env.NOODLE_CLEANUP_LEGACY_GLOBAL ?? "1") !== "0";
    if (shouldCleanupLegacy) {
      const globalCommands = await rest.get(Routes.applicationCommands(clientId));
      const removedLegacyGlobal = await cleanupLegacyCommands(
        globalCommands,
        (commandId) => rest.delete(Routes.applicationCommand(clientId, commandId))
      );
      if (removedLegacyGlobal > 0) {
        console.log(`Removed ${removedLegacyGlobal} legacy global command(s).`);
      }

      const removedGlobalDuplicates = await cleanupDuplicateCommands(
        await rest.get(Routes.applicationCommands(clientId)),
        (commandId) => rest.delete(Routes.applicationCommand(clientId, commandId))
      );
      if (removedGlobalDuplicates > 0) {
        console.log(`Removed ${removedGlobalDuplicates} duplicate global command(s).`);
      }
    }
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log("Registered global commands (Discord can take up to 1 hour to propagate).");

    const removedGlobalDuplicates = await cleanupDuplicateCommands(
      await rest.get(Routes.applicationCommands(clientId)),
      (commandId) => rest.delete(Routes.applicationCommand(clientId, commandId))
    );
    if (removedGlobalDuplicates > 0) {
      console.log(`Removed ${removedGlobalDuplicates} duplicate global command(s).`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
