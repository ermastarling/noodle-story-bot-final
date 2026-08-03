import "dotenv/config";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveRegistrationGuildId } from "./util/guildConfig.js";

// Skip loading native SQLite bindings during command registration to improve startup performance and avoid unnecessary dependencies.
process.env.NOODLE_SKIP_DB = process.env.NOODLE_SKIP_DB || "1";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = resolveRegistrationGuildId(process.env);
const guildRegistrationMode = String(process.env.NOODLE_GUILD_REGISTRATION_MODE || "dev-overrides").toLowerCase();
const guildOverrideNames = new Set(
  String(process.env.NOODLE_GUILD_OVERRIDE_COMMANDS || "noodle-dev")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
);

const FORBIDDEN_GLOBAL_COMMANDS = new Set(["noodle-dev"]);

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

async function loadCommandBodyForRegistration({ includeDevCommands }) {
  const commandsIndexUrl = pathToFileURL(fileURLToPath(new URL("./commands/index.js", import.meta.url))).href;
  const script = [
    `import { commands } from ${JSON.stringify(commandsIndexUrl)};`,
    "const body = (commands || []).map((c) => c.data.toJSON());",
    "process.stdout.write(JSON.stringify(body));"
  ].join("\n");

  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NOODLE_SKIP_DB: "1",
        NOODLE_INCLUDE_DEV_COMMANDS: includeDevCommands ? "1" : "0"
      }
    }
  );

  if (child.status !== 0) {
    const err = new Error(`Failed to load command payload (includeDevCommands=${includeDevCommands ? "1" : "0"})`);
    err.details = child.stderr || child.stdout || "unknown error";
    throw err;
  }

  const raw = String(child.stdout || "[]").trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function buildGuildOverrideBody(globalBody, guildBody) {
  const globalByName = new Map((globalBody || []).map((cmd) => [cmd?.name, cmd]));
  return (guildBody || []).filter((guildCmd) => {
    const name = guildCmd?.name;
    if (!name) return false;
    if (!guildOverrideNames.has(name)) return false;
    const globalCmd = globalByName.get(name);
    if (!globalCmd) return true;
    return JSON.stringify(globalCmd) !== JSON.stringify(guildCmd);
  });
}

function filterGlobalOnlyBody(body) {
  return (body || []).filter((cmd) => !FORBIDDEN_GLOBAL_COMMANDS.has(String(cmd?.name ?? "").trim()));
}

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);
  const useDevOverridesMode = Boolean(guildId) && guildRegistrationMode !== "full";

  if (useDevOverridesMode) {
    const globalBody = filterGlobalOnlyBody(await loadCommandBodyForRegistration({ includeDevCommands: false }));
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

    const guildBody = await loadCommandBodyForRegistration({ includeDevCommands: true });
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

  const body = await loadCommandBodyForRegistration({ includeDevCommands: Boolean(guildId) });
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
    const globalBody = filterGlobalOnlyBody(body);
    await rest.put(Routes.applicationCommands(clientId), { body: globalBody });
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
  if (e?.details) {
    console.error(e.details);
  }
  console.error(e);
  process.exit(1);
});
