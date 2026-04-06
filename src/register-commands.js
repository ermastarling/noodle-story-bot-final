import "dotenv/config";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

// Skip loading native SQLite bindings during command registration to improve startup performance and avoid unnecessary dependencies.
process.env.NOODLE_SKIP_DB = process.env.NOODLE_SKIP_DB || "1";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID || "";
const guildRegistrationMode = String(process.env.NOODLE_GUILD_REGISTRATION_MODE || "dev-overrides").toLowerCase();

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

async function cleanupGlobalOverlapCommands(commands, targetNames, deleteCommandById) {
  const names = new Set((targetNames || []).map((n) => String(n ?? "").trim()).filter(Boolean));
  if (!names.size) return 0;

  const overlap = (commands || []).filter((cmd) => names.has(String(cmd?.name ?? "").trim()));
  for (const cmd of overlap) {
    await deleteCommandById(cmd.id);
  }
  return overlap.length;
}

async function loadCommandsForRegistration({ includeDevCommands }) {
  process.env.NOODLE_INCLUDE_DEV_COMMANDS = includeDevCommands ? "1" : "0";
  const stamp = `${includeDevCommands ? "dev" : "nodev"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mod = await import(`./commands/index.js?register=${stamp}`);
  return mod.commands || [];
}

function toCommandBody(commands) {
  return (commands || []).map((c) => c.data.toJSON());
}

function buildGuildOverrideBody(globalBody, guildBody) {
  const globalByName = new Map((globalBody || []).map((cmd) => [cmd?.name, cmd]));
  return (guildBody || []).filter((guildCmd) => {
    const name = guildCmd?.name;
    if (!name) return false;
    const globalCmd = globalByName.get(name);
    if (!globalCmd) return true;
    return JSON.stringify(globalCmd) !== JSON.stringify(guildCmd);
  });
}

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);
  const useDevOverridesMode = Boolean(guildId) && guildRegistrationMode !== "full";

  if (useDevOverridesMode) {
    const globalCommands = await loadCommandsForRegistration({ includeDevCommands: false });
    const globalBody = toCommandBody(globalCommands);
    console.log(`Registering ${globalBody.length} global command(s) for application ${clientId}`);

    await rest.put(Routes.applicationCommands(clientId), { body: globalBody });
    console.log("Registered global commands (Discord can take up to 1 hour to propagate).");

    const removedGlobalDuplicates = await cleanupDuplicateCommands(
      await rest.get(Routes.applicationCommands(clientId)),
      (commandId) => rest.delete(Routes.applicationCommand(clientId, commandId))
    );
    if (removedGlobalDuplicates > 0) {
      console.log(`Removed ${removedGlobalDuplicates} duplicate global command(s).`);
    }

    const guildCommands = await loadCommandsForRegistration({ includeDevCommands: true });
    const guildBody = toCommandBody(guildCommands);
    const guildOverrideBody = buildGuildOverrideBody(globalBody, guildBody);

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: guildOverrideBody });
    console.log(`Registered ${guildOverrideBody.length} guild override command(s) for ${guildId}`);

    const removedGuildDuplicates = await cleanupDuplicateCommands(
      await rest.get(Routes.applicationGuildCommands(clientId, guildId)),
      (commandId) => rest.delete(Routes.applicationGuildCommand(clientId, guildId, commandId))
    );
    if (removedGuildDuplicates > 0) {
      console.log(`Removed ${removedGuildDuplicates} duplicate guild command(s).`);
    }

    const shouldCleanupLegacy = String(process.env.NOODLE_CLEANUP_LEGACY_GLOBAL ?? "1") !== "0";
    if (shouldCleanupLegacy) {
      const removedLegacyGlobal = await cleanupLegacyCommands(
        await rest.get(Routes.applicationCommands(clientId)),
        (commandId) => rest.delete(Routes.applicationCommand(clientId, commandId))
      );
      if (removedLegacyGlobal > 0) {
        console.log(`Removed ${removedLegacyGlobal} legacy global command(s).`);
      }
    }
    return;
  }

  const commands = await loadCommandsForRegistration({ includeDevCommands: Boolean(guildId) });
  const body = toCommandBody(commands);
  const registeredCommandNames = body.map((cmd) => cmd?.name).filter(Boolean);

  console.log(`Registering ${body.length} commands for application ${clientId}`);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`Registered guild commands for ${guildId}`);

    // Guild-mode registration can show duplicate entries in that guild when
    // same-name global commands still exist; remove global overlap by default.
    const shouldCleanupGlobalOverlap = String(process.env.NOODLE_CLEANUP_GLOBAL_OVERLAP ?? "1") !== "0";
    if (shouldCleanupGlobalOverlap) {
      const removedGlobalOverlap = await cleanupGlobalOverlapCommands(
        await rest.get(Routes.applicationCommands(clientId)),
        registeredCommandNames,
        (commandId) => rest.delete(Routes.applicationCommand(clientId, commandId))
      );
      if (removedGlobalOverlap > 0) {
        console.log(`Removed ${removedGlobalOverlap} overlapping global command(s) for guild mode.`);
      }
    }

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
