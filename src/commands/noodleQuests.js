import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { loadQuestsContent, loadDailyRewards } from "../content/index.js";
import { claimDailyReward } from "../game/daily.js";
import { claimCompletedQuests, getQuestSummary } from "../game/quests.js";
import { theme } from "../ui/theme.js";
import { getIcon } from "../ui/icons.js";

const {
  MessageEmbed
} = discordPkg;

const EmbedBuilder = MessageEmbed;

const db = openDb();
const questsContent = loadQuestsContent();
const dailyRewards = loadDailyRewards();

function ownerFooterText(userOrMember) {
  const member = userOrMember?.user ? userOrMember : null;
  const fallbackUser = member?.user ?? userOrMember;
  const displayName = member?.displayName ?? userOrMember?.displayName ?? userOrMember?.nickname ?? null;
  const tag = fallbackUser?.tag ?? fallbackUser?.username ?? "Unknown";
  const name = displayName ?? fallbackUser?.globalName ?? tag;
  return `Owner: ${name}`;
}

function applyOwnerFooter(embed, user) {
  if (embed && user) {
    embed.setFooter({ text: ownerFooterText(user) });
  }
  return embed;
}

function buildMenuEmbed({ title, description, user, color = theme.colors.primary } = {}) {
  const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
  return applyOwnerFooter(embed, user);
}

export const noodleQuestsCommand = {
  data: new SlashCommandBuilder()
    .setName("noodle-quests")
    .setDescription("View quests and claim daily rewards")
    .addSubcommand((sub) =>
      sub
        .setName("daily")
        .setDescription("Claim your daily reward")
    )
    .addSubcommand((sub) =>
      sub
        .setName("claim")
        .setDescription("Claim completed quest rewards")
    ),
  execute: noodleQuestsHandler
};

export async function noodleQuestsHandler(interaction) {
  const userId = interaction.user.id;
  const serverId = interaction.guild?.id ?? "DM";

  const commit = async (payload) => {
    if (interaction.replied || interaction.deferred) {
      return interaction.editReply(payload);
    }
    return interaction.reply(payload);
  };

  const idempKey = makeIdempotencyKey({
    serverId,
    userId,
    action: "noodle-quests",
    interactionId: interaction.id
  });
  const cached = getIdempotentResult(db, idempKey);
  if (cached) return commit(cached);

  return withLock(db, `user:${userId}`, `discord:${interaction.id}`, 8000, async () => {
    let player = getPlayer(db, serverId, userId);
    let server = getServer(db, serverId);
    if (!player) player = newPlayerProfile(userId);
    if (!server) server = newServerState(serverId);

    const sub = interaction.options.getSubcommand();
    let reply;

    if (sub === "daily") {
      const result = claimDailyReward(player, dailyRewards);
      if (!result.ok) {
        const embed = buildMenuEmbed({
          title: `${getIcon("daily_reward")} Daily Reward`,
          description: result.message,
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed], ephemeral: true };
      } else {
        const rewardLines = [];
        if (result.reward.coins) rewardLines.push(`${getIcon("coins")} **${result.reward.coins}c**`);
        if (result.reward.sxp) rewardLines.push(`${getIcon("sxp")} **${result.reward.sxp} SXP**`);
        if (result.reward.rep) rewardLines.push(`${getIcon("rep")} **${result.reward.rep} REP**`);

        const levelLine = result.leveledUp > 0 ? `
${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
        const embed = buildMenuEmbed({
          title: `${getIcon("daily_reward")} Daily Reward`,
          description: `Streak: **${result.streak}** day(s)\nRewards: ${rewardLines.join(" · ")}${levelLine}`,
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed] };
      }
    }

    if (sub === "quests") {
      const summary = getQuestSummary(player, questsContent, userId);
      const active = summary.active;
      if (!active.length) {
        const embed = buildMenuEmbed({
          title: `${getIcon("quests")} Quests`,
          description: "_No quests available right now._",
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed], ephemeral: true };
      } else {
        const lines = active.map((q) => {
          const status = q.completed_at ? getIcon("status_complete") : getIcon("status_pending");
          const rewardParts = [];
          if (q.reward?.coins) rewardParts.push(`${q.reward.coins}c`);
          if (q.reward?.sxp) rewardParts.push(`${q.reward.sxp} SXP`);
          if (q.reward?.rep) rewardParts.push(`${q.reward.rep} REP`);
          const rewardText = rewardParts.length ? ` — ${rewardParts.join(" · ")}` : "";
          return `${status} **${q.name}** (${q.progress}/${q.target})${rewardText}`;
        });

        const embed = buildMenuEmbed({
          title: `${getIcon("quests")} Quests`,
          description: lines.join("\n"),
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed] };
      }
    }

    if (sub === "claim") {
      const result = claimCompletedQuests(player);
      if (!result.claimed.length) {
        const embed = buildMenuEmbed({
          title: `${getIcon("quest_rewards")} Quest Rewards`,
          description: "_No completed quests to claim._",
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed], ephemeral: true };
      } else {
        const lines = result.claimed.map((entry) => {
          const rewardParts = [];
          if (entry.reward?.coins) rewardParts.push(`${entry.reward.coins}c`);
          if (entry.reward?.sxp) rewardParts.push(`${entry.reward.sxp} SXP`);
          if (entry.reward?.rep) rewardParts.push(`${entry.reward.rep} REP`);
          return `${getIcon("status_complete")} **${entry.quest.name}** — ${rewardParts.join(" · ")}`;
        });

        const levelLine = result.leveledUp > 0 ? `
${getIcon("level_up")} Level up! **+${result.leveledUp}**` : "";
        const embed = buildMenuEmbed({
          title: `${getIcon("quest_rewards")} Quest Rewards`,
          description: `${lines.join("\n")}${levelLine}`,
          user: interaction.member ?? interaction.user
        });
        reply = { content: " ", embeds: [embed] };
      }
    }

    upsertPlayer(db, serverId, userId, player, null, player.schema_version);
    upsertServer(db, serverId, server, null);

    putIdempotentResult(db, { key: idempKey, userId, action: "noodle-quests", ttlSeconds: 900, result: reply });
    return commit(reply);
  });
}
