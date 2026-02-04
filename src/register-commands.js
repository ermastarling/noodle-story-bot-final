import "dotenv/config";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";

if (!process.env.NOODLE_SKIP_DB) {
  process.env.NOODLE_SKIP_DB = "1";
}

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID || "";

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
  process.exit(1);
}

async function main() {
  const { commands } = await import("./commands/index.js");
  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.map(c => c.data.toJSON());

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`Registered guild commands for ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log("Registered global commands");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
