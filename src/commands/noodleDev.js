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
      .addUserOption((o) => o.setName("user").setDescription("User to reset (defaults to you)").setRequired(false))
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
  )
  .addSubcommand((sc) =>
    sc
      .setName("repair_party")
      .setDescription("Dev only.")
      .addStringOption((o) =>
        o
          .setName("party_id")
          .setDescription("Party ID or prefix (e.g. first 8 chars)")
          .setRequired(true)
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
      .setName("subscriptions")
      .setDescription("Dev only.")
      .addUserOption((o) => o.setName("user").setDescription("User to inspect").setRequired(false))
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
      .setName("giveaway_winner")
      .setDescription("Dev only.")
      .addStringOption((o) =>
        o
          .setName("reward_type")
          .setDescription("Type of reward to grant")
          .setRequired(true)
          .addChoices(
            { name: "Perk", value: "perk" },
            { name: "Coin Pack", value: "coin_pack" },
            { name: "Coins", value: "coins" }
          )
      )
      .addStringOption((o) =>
        o
          .setName("perk")
          .setDescription("Perk to grant (required when reward_type=perk)")
          .setRequired(false)
          .addChoices(
            { name: "24/7 House", value: "house_247" },
            { name: "Take Out Counter", value: "takeout_counter" },
            { name: "Both Perks", value: "both" }
          )
      )
      .addStringOption((o) =>
        o
          .setName("coin_pack")
          .setDescription("Coin pack to grant (required when reward_type=coin_pack)")
          .setRequired(false)
          .addChoices(
            { name: "Chef's Coin Crate (10,000c)", value: "coin_pack_099" },
            { name: "Brothkeeper's Savings (25,000c)", value: "coin_pack_199" },
            { name: "Greedy Noodle Goblin Hoard (100,000c)", value: "coin_pack_499" }
          )
      )
      .addIntegerOption((o) =>
        o
          .setName("coins")
          .setDescription("Coins to grant (required when reward_type=coins)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(1000000000)
      )
      .addUserOption((o) => o.setName("user").setDescription("User to update").setRequired(false))
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
      .addIntegerOption((o) =>
        o
          .setName("duration_days")
          .setDescription("When rewarding a perk, duration in days (default 30)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(365)
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Optional audit reason")
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
    const denyOwnerMismatch = async (message) => {
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: message, ephemeral: true });
      }
      return interaction.reply({ content: message, ephemeral: true });
    };

    const customId = String(interaction.customId || "");
    const parts = customId.split(":");
    // Legacy: noodle-dev:dashboard:page:<ownerUserId>:<tabPage>
    // New:    noodle-dev:dashboard:nav:<ownerUserId>:<tabPage>:<serverPage>
    if (parts[0] !== "noodle-dev" || parts[1] !== "dashboard") return null;

    const mode = parts[2] ?? "";
    if (mode !== "page" && mode !== "nav") return null;

    const ownerUserId = parts[3] ?? "";
    const page = Number(parts[4] ?? 0);
    const serverPage = mode === "nav" ? Number(parts[5] ?? 0) : 0;
    if (ownerUserId && ownerUserId !== interaction.user.id) {
      return denyOwnerMismatch("That dashboard isn’t for you.");
    }

    return runNoodle(interaction, {
      sub: "dashboard",
      group: "dev",
      overrides: {
        integers: {
          dashboard_page: Number.isInteger(page) ? page : 0,
          dashboard_server_page: Number.isInteger(serverPage) ? serverPage : 0
        }
      }
    });
  }
};
