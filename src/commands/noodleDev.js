import { SlashCommandBuilder } from "@discordjs/builders";
import { runNoodle } from "./noodle.js";

const noodleDevData = new SlashCommandBuilder()
  .setName("noodle-dev")
  .setDescription("Developer tools for Noodle Story.")
  .addSubcommand((sc) => sc.setName("status").setDescription("Show reset timestamps (debug info)."))
  .addSubcommand((sc) => sc.setName("servers").setDescription(" "))
  .addSubcommand((sc) =>
    sc
      .setName("reset_tutorial")
      .setDescription("Reset a user tutorial progress.")
      .addUserOption((o) => o.setName("user").setDescription("User to reset").setRequired(true))
  )
  .addSubcommand((sc) =>
    sc
      .setName("wipe_user")
      .setDescription("Delete a user profile from the DB.")
      .addUserOption((o) => o.setName("user").setDescription("User to wipe").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("user_id")
          .setDescription("User ID (use if the user left the server)")
          .setRequired(false)
      )
      .addStringOption((o) =>
        o
          .setName("server_id")
          .setDescription("Override server ID (defaults to current guild)")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("repair_profile")
      .setDescription("Repair a user profile from the strongest legacy server profile.")
      .addUserOption((o) => o.setName("user").setDescription("User to repair").setRequired(false))
      .addStringOption((o) =>
        o
          .setName("user_id")
          .setDescription("User ID (use if the user left the server)")
          .setRequired(false)
      )
      .addBooleanOption((o) =>
        o
          .setName("force")
          .setDescription("Force repair even if global profile score is not lower")
          .setRequired(false)
      )
  );

export const noodleDevCommand = {
  data: noodleDevData,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    return runNoodle(interaction, { sub, group: "dev" });
  }
};
