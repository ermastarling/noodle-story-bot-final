import { SlashCommandBuilder } from "@discordjs/builders";
import { runNoodle } from "./noodle.js";
import { loadContentBundle, loadEventsContent, loadSpecializationsContent } from "../content/index.js";
import { withEventRecipes } from "../game/events.js";

const content = loadContentBundle();
const eventsContent = loadEventsContent();
const contentWithEventRecipes = withEventRecipes(content, eventsContent);
const specializationsContent = loadSpecializationsContent();

function buildAutocompleteResults(entries, query) {
  const q = String(query ?? "").trim().toLowerCase();
  return entries
    .filter((entry) => {
      const id = String(entry.id ?? "").toLowerCase();
      const name = String(entry.name ?? "").toLowerCase();
      return !q || id.includes(q) || name.includes(q);
    })
    .slice(0, 25)
    .map((entry) => ({
      name: String(`${entry.name} (${entry.id})`).slice(0, 100),
      value: String(entry.id).slice(0, 100)
    }));
}

const specializationAutocompleteEntries = (specializationsContent?.specializations ?? []).map((spec) => ({
  id: spec.spec_id,
  name: spec.name ?? spec.spec_id
}));

const recipeAutocompleteEntries = Object.entries(contentWithEventRecipes?.recipes ?? {}).map(([id, recipe]) => ({
  id,
  name: recipe?.name ?? id
}));

const seasonEventAutocompleteEntries = (eventsContent?.events ?? []).map((event) => ({
  id: event.event_id,
  name: event.name ?? event.event_id
}));

const noodleDevData = new SlashCommandBuilder()
  .setName("noodle-dev")
  .setDescription("Developer tools for Noodle Story.")
  .addSubcommand((sc) => sc.setName("status").setDescription("Dev only."))
  .addSubcommand((sc) =>
    sc
      .setName("reminder_test")
      .setDescription("Dev only.")
      .addUserOption((o) => o.setName("user").setDescription("User to DM (defaults to you)").setRequired(false))
      .addBooleanOption((o) =>
        o
          .setName("force")
          .setDescription("Send even if daily is unavailable or already sent today")
          .setRequired(false)
      )
  )
  .addSubcommand((sc) => sc.setName("dashboard").setDescription("Dev only."))
  .addSubcommandGroup((sg) =>
    sg
      .setName("admin")
      .setDescription("Dev only.")
      .addSubcommand((sc) =>
        sc
          .setName("stat")
          .setDescription("Dev only.")
          .addStringOption((o) =>
            o
              .setName("field")
              .setDescription("Stat to set")
              .setRequired(true)
              .addChoices(
                { name: "Bowls Served", value: "bowls_served" },
                { name: "Level", value: "level" },
                { name: "REP", value: "rep" }
              )
          )
          .addIntegerOption((o) =>
            o
              .setName("value")
              .setDescription("Absolute value to apply")
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(1000000000)
          )
          .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(false))
          .addStringOption((o) => o.setName("user_id").setDescription("Target user ID").setRequired(false))
          .addStringOption((o) => o.setName("server_id").setDescription("Override server ID").setRequired(false))
      )
      .addSubcommand((sc) =>
        sc
          .setName("spec")
          .setDescription("Dev only.")
          .addStringOption((o) => o.setName("spec_id").setDescription("Specialization ID").setRequired(true).setAutocomplete(true))
          .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(false))
          .addStringOption((o) => o.setName("user_id").setDescription("Target user ID").setRequired(false))
          .addStringOption((o) => o.setName("server_id").setDescription("Override server ID").setRequired(false))
      )
      .addSubcommand((sc) =>
        sc
          .setName("recipe")
          .setDescription("Dev only.")
          .addStringOption((o) => o.setName("recipe_id").setDescription("Recipe ID").setRequired(true).setAutocomplete(true))
          .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(false))
          .addStringOption((o) => o.setName("user_id").setDescription("Target user ID").setRequired(false))
          .addStringOption((o) => o.setName("server_id").setDescription("Override server ID").setRequired(false))
      )
      .addSubcommand((sc) =>
        sc
          .setName("season_event")
          .setDescription("Dev only.")
          .addStringOption((o) =>
            o
              .setName("event_id")
              .setDescription("Event ID to activate")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .addStringOption((o) => o.setName("server_id").setDescription("Override server ID").setRequired(false))
      )
  )
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
    const rawGroup = interaction.options.getSubcommandGroup(false);
    const rawSub = interaction.options.getSubcommand();
    const sub = rawGroup === "admin" ? `admin_${rawSub}` : rawSub;
    return runNoodle(interaction, { sub, group: "dev" });
  },

  async autocomplete(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);
    const query = String(focused?.value ?? "");

    if (group !== "admin") return interaction.respond([]);

    if (sub === "spec" && focused?.name === "spec_id") {
      return interaction.respond(buildAutocompleteResults(specializationAutocompleteEntries, query));
    }

    if (sub === "recipe" && focused?.name === "recipe_id") {
      return interaction.respond(buildAutocompleteResults(recipeAutocompleteEntries, query));
    }

    if (sub === "season_event" && focused?.name === "event_id") {
      return interaction.respond(buildAutocompleteResults(seasonEventAutocompleteEntries, query));
    }

    return interaction.respond([]);
  },

  async handleComponent(interaction) {
    const denyOwnerMismatch = async (message) => {
      if (interaction.deferred || interaction.replied) {
        try {
          // Complete deferred component interaction first so the original response does not hang.
          await interaction.editReply({
            content: interaction.message?.content ?? " ",
            components: interaction.message?.components ?? []
          });
        } catch {
          // Best-effort: if edit fails, still attempt to notify the user.
        }
        return interaction.followUp({ content: message, ephemeral: true });
      }
      return interaction.reply({ content: message, ephemeral: true });
    };

    const customId = String(interaction.customId || "");
    const parts = customId.split(":");
    if (parts[0] === "noodle-dev" && parts[1] === "status" && parts[2] === "refresh") {
      const ownerUserId = parts[3] ?? "";
      if (ownerUserId && ownerUserId !== interaction.user.id) {
        return denyOwnerMismatch("That status panel isn’t for you.");
      }
      return runNoodle(interaction, { sub: "status", group: "dev" });
    }

    // Legacy: noodle-dev:dashboard:page:<ownerUserId>:<tabPage>
    // New:    noodle-dev:dashboard:nav:<ownerUserId>:<tabPage>:<serverPage>
    // Also:   noodle-dev:dashboard:refresh:<ownerUserId>:<tabPage>:<serverPage>
    if (parts[0] !== "noodle-dev" || parts[1] !== "dashboard") return null;

    const mode = parts[2] ?? "";
    if (mode !== "page" && mode !== "nav" && mode !== "refresh") return null;

    const ownerUserId = parts[3] ?? "";
    const page = Number(parts[4] ?? 0);
    const serverPage = mode === "nav" || mode === "refresh" ? Number(parts[5] ?? 0) : 0;
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
