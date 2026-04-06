import { SlashCommandBuilder } from "@discordjs/builders";
import { runNoodle } from "./noodle.js";

const noodleDevData = new SlashCommandBuilder()
  .setName("noodle-dev")
  .setDescription("Developer tools for Noodle Story.")
  .addSubcommand((sc) => sc.setName("status").setDescription("Dev only."))
  .addSubcommand((sc) => sc.setName("dashboard").setDescription("Dev only."))
  .addSubcommand((sc) =>
    sc
      .setName("reset_tutorial")
      .setDescription("Dev only.")
      .addUserOption((o) => o.setName("user").setDescription("User to reset").setRequired(true))
  )
  .addSubcommand((sc) =>
    sc
      .setName("wipe_user")
      .setDescription("Dev only.")
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
      .setDescription("Dev only.")
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
  },

  async handleComponent(interaction) {
    const customId = String(interaction.customId || "");
    const parts = customId.split(":");
    // noodle-dev:dashboard:page:<ownerUserId>:<page>
    if (parts[0] !== "noodle-dev" || parts[1] !== "dashboard" || parts[2] !== "page") return null;

    const ownerUserId = parts[3] ?? "";
    const page = Number(parts[4] ?? 0);
    if (ownerUserId && ownerUserId !== interaction.user.id) {
      return {
        content: "That dashboard isn’t for you.",
        ephemeral: true
      };
    }

    return runNoodle(interaction, {
      sub: "dashboard",
      group: "dev",
      overrides: {
        integers: {
          dashboard_page: Number.isInteger(page) ? page : 0
        }
      }
    });
  }
};
