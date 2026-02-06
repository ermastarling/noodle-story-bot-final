import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { applySxpLevelUp } from "../game/serve.js";
import { loadContentBundle } from "../content/index.js";
import { noodleMainMenuRowNoProfile, displayItemName, renderProfileEmbed } from "./noodle.js";
import {
  grantBlessing,
  getActiveBlessing,
  createParty,
  joinParty,
  inviteUserToParty,
  leaveParty,
  getParty,
  getUserActiveParty,
  renameParty,
  transferPartyLeadership,
  kickPartyMember,
  transferTip,
  getUserTipStats,
  logVisitActivity,
  getVisitPatternSummary,
  createSharedOrder,
  contributeToSharedOrder,
  getSharedOrderContributions,
  completeSharedOrder,
  cancelSharedOrder,
  getActiveSharedOrderByParty,
  BLESSING_DURATION_HOURS,
  BLESSING_COOLDOWN_HOURS,
  BLESSING_TYPES
} from "../game/social.js";
import { nowTs } from "../util/time.js";
import { containsProfanity } from "../util/profanity.js";

const {
  MessageActionRow,
  MessageSelectMenu,
  MessageButton,
  MessageEmbed,
  Modal,
  TextInputComponent,
  Constants
} = discordPkg;

// Aliases for v14+ compatibility
const ActionRowBuilder = MessageActionRow;
const StringSelectMenuBuilder = MessageSelectMenu;
const ButtonBuilder = MessageButton;
const EmbedBuilder = MessageEmbed;
const ModalBuilder = Modal;
const TextInputBuilder = TextInputComponent;

const ButtonStyle = {
  Primary: Constants?.MessageButtonStyles?.PRIMARY ?? 1,
  Secondary: Constants?.MessageButtonStyles?.SECONDARY ?? 2,
  Success: Constants?.MessageButtonStyles?.SUCCESS ?? 3,
  Danger: Constants?.MessageButtonStyles?.DANGER ?? 4,
  Link: Constants?.MessageButtonStyles?.LINK ?? 5
};

const db = openDb();
const content = loadContentBundle(1);

const SHARED_ORDER_MIN_SERVINGS = 5;
const SHARED_ORDER_REWARD = {
  coinsPerServing: 120,
  repPerServing: 6,
  sxpPerServing: 15
};

/* ------------------------------------------------------------------ */
/*  UI Button Helpers                                                  */
/* ------------------------------------------------------------------ */

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

/**
 * Main social menu navigation buttons
 */
function socialMainMenuRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:party:${userId}`)
      .setLabel("🎪 Party")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle-upgrades:category:${userId}:all:profile`)
      .setLabel("🔧 Upgrades")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:stats:${userId}`)
      .setLabel("📈 Stats")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:profile:${userId}`)
      .setLabel("🍜 Profile")
      .setStyle(ButtonStyle.Secondary)
  );
}

function socialMainMenuRowNoProfile(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:party:${userId}`)
      .setLabel("🎪 Party")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle-upgrades:category:${userId}:all:profile`)
      .setLabel("🔧 Upgrades")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:stats:${userId}`)
      .setLabel("📈 Stats")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:quests:${userId}`)
      .setLabel("📜 Quests")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:profile_edit:${userId}`)
      .setLabel("✏️ Customize")
      .setStyle(ButtonStyle.Secondary)
  );
}

async function resolveUserIdFromInput(input, interaction) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  // Try mention/id first (for safety)
  const mentionMatch = raw.match(/^<@!?([0-9]{17,20})>$/);
  if (mentionMatch) return mentionMatch[1];
  const idMatch = raw.match(/^([0-9]{17,20})$/);
  if (idMatch) return idMatch[1];

  const guild = interaction.guild;
  if (!guild) return null;

  const query = raw.toLowerCase();
  const cached = guild.members.cache.find((m) => {
    const nick = m.nickname?.toLowerCase();
    const user = m.user?.username?.toLowerCase();
    const global = m.user?.globalName?.toLowerCase();
    return nick === query || user === query || global === query;
  });
  if (cached) return cached.user.id;

  // Fallback: search by username/nickname
  const results = await guild.members.search({ query: raw, limit: 5 }).catch(() => null);
  if (!results || results.size === 0) return null;
  const exact = results.find((m) => {
    const nick = m.nickname?.toLowerCase();
    const user = m.user?.username?.toLowerCase();
    const global = m.user?.globalName?.toLowerCase();
    return nick === query || user === query || global === query;
  });
  return (exact ?? results.first())?.user?.id ?? null;
}

/**
 * Party action buttons (conditional based on party state)
 */
function partyActionRow(userId, inParty, isPartyLeader, hasActiveSharedOrder = false) {
  const components = [];

  // Tip + Bless buttons (always available from party menu)
  components.push(
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:tip:${userId}`)
      .setLabel("💰 Tip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:bless:${userId}`)
      .setLabel("✨ Bless")
      .setStyle(ButtonStyle.Secondary)
  );
  
  // Shared Order button: leader always sees it, members only if active shared order exists
  if (isPartyLeader || hasActiveSharedOrder) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`noodle-social:action:shared_order:${userId}`)
        .setLabel("🍜 Shared Order")
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  // Invite button only if user is party leader
  if (isPartyLeader) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`noodle-social:action:party_invite:${userId}`)
        .setLabel("➕ Invite User")
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  // Leave button only if in a party
  if (inParty) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`noodle-social:action:party_leave:${userId}`)
        .setLabel("🚪 Leave Party")
        .setStyle(ButtonStyle.Danger)
    );
  }
  
  return new ActionRowBuilder().addComponents(components);
}

function sharedOrderActionRow(userId, hasActiveOrder, isPartyLeader, canComplete = false) {
  const components = [];

  if (hasActiveOrder) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`noodle-social:action:shared_order_contribute:${userId}`)
        .setLabel("🥕 Contribute")
        .setStyle(ButtonStyle.Secondary)
    );

    if (isPartyLeader) {
      components.push(
        new ButtonBuilder()
          .setCustomId(`noodle-social:action:shared_order_cancel:${userId}`)
          .setLabel("🧹 Cancel Order")
          .setStyle(ButtonStyle.Danger)
      );

      if (canComplete) {
        components.push(
          new ButtonBuilder()
            .setCustomId(`noodle-social:action:shared_order_complete:${userId}`)
            .setLabel("✅ Complete Order")
            .setStyle(ButtonStyle.Success)
        );
      }
    }
  } else {
    if (isPartyLeader) {
      components.push(
        new ButtonBuilder()
          .setCustomId(`noodle-social:action:shared_order_create:${userId}`)
          .setLabel("🍜 Create Shared Order")
          .setStyle(ButtonStyle.Primary)
      );
    }
  }

  return new ActionRowBuilder().addComponents(components);
}

function buildSharedOrderProgress({ recipe, servings, contributions }) {
  const contribByIngredient = {};
  for (const c of contributions ?? []) {
    if (!c?.ingredient_id) continue;
    contribByIngredient[c.ingredient_id] = (contribByIngredient[c.ingredient_id] ?? 0) + (c.quantity ?? 0);
  }

  const items = (recipe?.ingredients ?? []).map((ing) => {
    const required = (ing.qty ?? 0) * servings;
    const contributed = contribByIngredient[ing.item_id] ?? 0;
    const remaining = Math.max(0, required - contributed);
    return {
      ingredientId: ing.item_id,
      required,
      contributed,
      remaining
    };
  });

  const isComplete = items.every((i) => i.remaining <= 0);
  return { items, isComplete };
}

/**
 * Party creation buttons (only shown if not in a party)
 */
function partyCreationRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:tip:${userId}`)
      .setLabel("💰 Tip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:bless:${userId}`)
      .setLabel("✨ Bless")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:party_create:${userId}`)
      .setLabel("🎪 Create Party")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:action:party_join:${userId}`)
      .setLabel("📥 Join Party")
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Social stats view buttons (two rows)
 */
function statsViewButtons(userId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:party:${userId}`)
      .setLabel("🎪 Party")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:leaderboard:${userId}`)
      .setLabel("📊 Leaderboard")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:collections:${userId}`)
      .setLabel("📚 Collections")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:nav:orders:${userId}`)
      .setLabel("📋 Orders")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:buy:${userId}`)
      .setLabel("🛒 Buy")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:nav:forage:${userId}`)
      .setLabel("🌿 Forage")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:profile:${userId}`)
      .setLabel("🍜 Profile")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

/* ------------------------------------------------------------------ */
/*  Helper functions                                                   */
/* ------------------------------------------------------------------ */

/**
 * Commit a component interaction response
 */
async function componentCommit(interaction, opts) {
  const { ephemeral, targetMessageId, ...rest } = opts ?? {};

  if (ephemeral) {
    if (interaction.deferred || interaction.replied) {
      try {
        await interaction.deleteReply();
      } catch (e) {
        // ignore if already deleted or not present
      }
      return interaction.followUp({ ...rest, ephemeral: true });
    }
    return interaction.reply({ ...rest, ephemeral: true });
  }

  if (targetMessageId) {
    try {
      const target = await interaction.channel?.messages?.fetch(targetMessageId);
      if (target) {
        const result = await target.edit(rest);
        if (interaction.deferred || interaction.replied) {
          try {
            await interaction.deleteReply();
          } catch (e) {
            // ignore if already deleted
          }
        }
        return result;
      }
    } catch (e) {
      // fall through to default reply flow
    }
  }

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(rest);
  }
  return interaction.update(rest);
}

async function errorReply(interaction, content) {
  const payload = { content, ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    try {
      await interaction.deleteReply();
    } catch (e) {
      // ignore if already deleted or not present
    }
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

/**
 * Format a party ID for display (first 8 characters)
 */
function formatPartyId(partyId) {
  return partyId.substring(0, 8);
}

function ensureServer(serverId) {
  if (!db) return newServerState(serverId);
  let s = getServer(db, serverId);
  if (!s) {
    s = newServerState(serverId);
    upsertServer(db, serverId, s, null);
    s = getServer(db, serverId);
  }
  return s;
}

function ensurePlayer(serverId, userId) {
  if (!db) return newPlayerProfile(userId);
  let p = getPlayer(db, serverId, userId);
  if (!p) {
    p = newPlayerProfile(userId);
    upsertPlayer(db, serverId, userId, p, null, p.schema_version);
    p = getPlayer(db, serverId, userId);
  }
  return p;
}

function cozyError(errOrCode) {
  const code = typeof errOrCode === "string" ? errOrCode : errOrCode?.code;
  const map = {
    ERR_LOCK_BUSY: "Your shop is already busy, try again in a moment.",
    LOCK_BUSY: "Your shop is already busy, try again in a moment.",
    ERR_CONFLICT: "State updated at the same time, run the command again."
  };
  return map[code] ?? "Something went sideways, try again.";
}

/* ------------------------------------------------------------------ */
/*  Command handlers                                                   */
/* ------------------------------------------------------------------ */

async function handleParty(interaction) {
  const serverId = interaction.guildId;
  const userId = interaction.user.id;
  const action = interaction.options.getString("action");
  const partyName = interaction.options.getString("name");
  const partyId = interaction.options.getString("party_id");
  const ownerLock = `discord:${interaction.id}`;

  const ensurePublicReply = async () => {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: false });
    }
  };

  if (!db) {
    return errorReply(interaction, "Database unavailable in this environment.");
  }
  return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
    const player = ensurePlayer(serverId, userId);

    if (action === "create") {
      if (!partyName) {
        return errorReply(interaction, "❌ Please provide a party name.");
      }
      const cleanedName = partyName.trim().replace(/\s+/g, " ");
      if (!cleanedName) {
        return errorReply(interaction, "❌ Please provide a party name.");
      }
      if (containsProfanity(cleanedName)) {
        return errorReply(interaction, "❌ Party name contains blocked words. Please keep it friendly.");
      }

      // Check if already in a party
      const currentParty = getUserActiveParty(db, userId);
      if (currentParty) {
        return errorReply(interaction, `❌ You're already in party **${currentParty.party_name}**. Leave it first to create a new one.`);
      }

      const result = createParty(db, serverId, userId, cleanedName);

      const embed = new EmbedBuilder()
        .setTitle("🎉 Party Created!")
        .setDescription(`You've created the party **${result.partyName}**`)
        .addFields(
          { name: "Party ID", value: `\`\`\`${formatPartyId(result.partyId)}\`\`\``, inline: true },
          { name: "Leader", value: `<@${userId}>`, inline: true }
        )
        .setColor(0x00ff00);

      applyOwnerFooter(embed, interaction.member ?? interaction.user);

      await ensurePublicReply();
      return interaction.editReply({ 
        embeds: [embed], 
        components: [partyActionRow(userId, true, true, false), socialMainMenuRow(userId)] 
      });
    }

    if (action === "join") {
      if (!partyId) {
        return errorReply(interaction, "❌ Please provide a party ID to join.");
      }

      try {
        const result = joinParty(db, partyId, userId);
        
        const embed = new EmbedBuilder()
          .setTitle("🎊 Joined Party!")
          .setDescription(`You've joined the party **${result.partyName}**`)
          .setColor(0x00ff00);

        applyOwnerFooter(embed, interaction.member ?? interaction.user);

        await ensurePublicReply();
        return interaction.editReply({ 
          embeds: [embed], 
          components: [partyActionRow(userId, true, false, false), socialMainMenuRow(userId)] 
        });
      } catch (err) {
        return errorReply(interaction, `❌ ${err.message}`);
      }
    }

    if (action === "leave") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return errorReply(interaction, "❌ You're not in any party.");
      }

      try {
        leaveParty(db, currentParty.party_id, userId);

        const embed = new EmbedBuilder()
          .setTitle("🎪 Party")
          .setDescription(`✅ You've left the party **${currentParty.party_name}**.`)
          .setColor(0x00aeff);
        applyOwnerFooter(embed, interaction.member ?? interaction.user);

        const replyObj = {
          content: " ",
          embeds: [embed],
          components: [partyCreationRow(userId), socialMainMenuRow(userId)]
        };

        const sourceMessageId = interaction.message?.id ?? null;
        if (sourceMessageId && interaction.channel?.messages) {
          try {
            const msg = await interaction.channel.messages.fetch(sourceMessageId);
            await msg.edit(replyObj);
            if (interaction.deferred || interaction.replied) {
              await interaction.deleteReply().catch(() => {});
            }
            return;
          } catch (e) {
            // fallback to editing interaction reply
          }
        }

        await ensurePublicReply();
        return interaction.editReply(replyObj);
      } catch (err) {
        return errorReply(interaction, `❌ ${err.message}`);
      }
    }

    if (action === "info") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return errorReply(interaction, "❌ You're not in any party.");
      }

      const memberList = currentParty.members
        .map((m, i) => `${i + 1}. <@${m.user_id}> (${m.contribution_points} points)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎪 ${currentParty.party_name}`)
        .setDescription(`Party ID:\n\`\`\`${formatPartyId(currentParty.party_id)}\`\`\``)
        .addFields(
          { name: "Leader", value: `<@${currentParty.leader_user_id}>`, inline: true },
          { name: "Members", value: `${currentParty.members.length}/${currentParty.max_members}`, inline: true },
          { name: "Member List", value: memberList || "No members", inline: false }
        )
        .setColor(0x00aeff);

      applyOwnerFooter(embed, interaction.member ?? interaction.user);

      const isLeader = currentParty.leader_user_id === userId;
      await ensurePublicReply();
      const existingOrder = getActiveSharedOrderByParty(db, currentParty.party_id);
      return interaction.editReply({ 
        embeds: [embed], 
        components: [partyActionRow(userId, true, isLeader, !!existingOrder), socialMainMenuRow(userId)] 
      });
    }

    if (action === "rename") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return errorReply(interaction, "❌ You're not in any party.");
      }
      if (currentParty.leader_user_id !== userId) {
        return errorReply(interaction, "❌ Only the party leader can rename the party.");
      }
      if (!partyName || !partyName.trim()) {
        return errorReply(interaction, "❌ Please provide a new party name.");
      }
      const cleanedName = partyName.trim().replace(/\s+/g, " ");
      if (containsProfanity(cleanedName)) {
        return errorReply(interaction, "❌ Party name contains blocked words. Please keep it friendly.");
      }

      try {
        const result = renameParty(db, currentParty.party_id, cleanedName);
        await ensurePublicReply();
        const existingOrder = getActiveSharedOrderByParty(db, currentParty.party_id);
        return interaction.editReply({
          content: `✅ Party renamed to **${result.partyName}**.`,
          components: [partyActionRow(userId, true, true, !!existingOrder), socialMainMenuRow(userId)]
        });
      } catch (err) {
        return errorReply(interaction, `❌ ${err.message}`);
      }
    }

    if (action === "transfer_leader") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return errorReply(interaction, "❌ You're not in any party.");
      }
      if (currentParty.leader_user_id !== userId) {
        return errorReply(interaction, "❌ Only the party leader can transfer leadership.");
      }

      const targetUser = interaction.options.getUser("user");
      if (!targetUser) {
        return errorReply(interaction, "❌ Please select a party member.");
      }
      if (targetUser.id === userId) {
        return errorReply(interaction, "❌ You are already the leader.");
      }

      const membership = db.prepare(
        "SELECT * FROM party_members WHERE party_id = ? AND user_id = ? AND left_at IS NULL"
      ).get(currentParty.party_id, targetUser.id);
      if (!membership) {
        return errorReply(interaction, "❌ That user is not in your party.");
      }

      try {
        transferPartyLeadership(db, currentParty.party_id, targetUser.id);
        await ensurePublicReply();
        const existingOrder = getActiveSharedOrderByParty(db, currentParty.party_id);
        return interaction.editReply({
          content: `✅ Leadership transferred to <@${targetUser.id}>.`,
          components: [partyActionRow(userId, true, false, !!existingOrder), socialMainMenuRow(userId)]
        });
      } catch (err) {
        return errorReply(interaction, `❌ ${err.message}`);
      }
    }

    if (action === "kick") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return errorReply(interaction, "❌ You're not in any party.");
      }
      if (currentParty.leader_user_id !== userId) {
        return errorReply(interaction, "❌ Only the party leader can kick members.");
      }

      const targetUser = interaction.options.getUser("user");
      if (!targetUser) {
        return errorReply(interaction, "❌ Please select a party member to kick.");
      }
      if (targetUser.id === userId) {
        return errorReply(interaction, "❌ You cannot kick yourself.");
      }

      const isMember = currentParty.members.some((m) => m.user_id === targetUser.id);
      if (!isMember) {
        return errorReply(interaction, "❌ That user is not in your party.");
      }

      try {
        kickPartyMember(db, currentParty.party_id, targetUser.id);
        return errorReply(interaction, `✅ Removed <@${targetUser.id}> from the party.`);
      } catch (err) {
        return errorReply(interaction, `❌ ${err.message}`);
      }
    }

    return errorReply(interaction, "❌ Unknown party action.");
  });
}

async function handleTip(interaction) {
  const serverId = interaction.guildId;
  const userId = interaction.user.id;
  const targetUser = interaction.options.getUser("user");
  const amount = interaction.options.getInteger("amount");
  const message = interaction.options.getString("message");

  if (!targetUser) {
    return interaction.reply({ content: "❌ Please specify a user to tip.", ephemeral: true });
  }

  if (targetUser.id === userId) {
    return interaction.reply({ content: "❌ You cannot tip yourself!", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: false });

  const action = "tip";
  const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
  const cached = db ? getIdempotentResult(db, idemKey) : null;
  if (cached) return interaction.editReply(cached);

  const ownerLock = `discord:${interaction.id}`;

  if (!db) {
    return errorReply(interaction, "Database unavailable in this environment.");
  }
  return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
    return await withLock(db, `lock:user:${targetUser.id}`, ownerLock, 8000, async () => {
      let sender = ensurePlayer(serverId, userId);
      let receiver = ensurePlayer(serverId, targetUser.id);

      try {
        const result = transferTip(db, serverId, sender, receiver, amount, message);

        // Save both players
        if (db) {
          upsertPlayer(db, serverId, userId, result.sender, null, result.sender.schema_version);
          upsertPlayer(db, serverId, targetUser.id, result.receiver, null, result.receiver.schema_version);
        }

        const embed = new EmbedBuilder()
          .setTitle("💰 Tip Sent!")
          .setDescription(`<@${userId}> tipped <@${targetUser.id}> **${amount}c**!`)
          .setColor(0xffd700);

        if (message) {
          embed.addFields({ name: "Message", value: message, inline: false });
        }

        embed.addFields(
          { name: "Your Balance", value: `${result.sender.coins}c`, inline: true },
          { name: "Their Balance", value: `${result.receiver.coins}c`, inline: true }
        );

        applyOwnerFooter(embed, interaction.member ?? interaction.user);

        const replyObj = { 
          embeds: [embed], 
          components: [socialMainMenuRow(userId)] 
        };
        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
        return interaction.editReply(replyObj);
      } catch (err) {
        return errorReply(interaction, `❌ ${err.message}`);
      }
    });
  });
}

async function handleVisit(interaction) {
  const serverId = interaction.guildId;
  const userId = interaction.user.id;
  const targetUser = interaction.options.getUser("user");

  if (!targetUser) {
    return interaction.reply({ content: "❌ Please specify a user to visit.", ephemeral: true });
  }

  if (targetUser.id === userId) {
    return interaction.reply({ content: "❌ You cannot visit yourself!", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: false });

  const action = "visit";
  const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
  const cached = db ? getIdempotentResult(db, idemKey) : null;
  if (cached) return interaction.editReply(cached);

  const ownerLock = `discord:${interaction.id}`;

  if (!db) {
    return errorReply(interaction, "Database unavailable in this environment.");
  }
  return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
    return await withLock(db, `lock:user:${targetUser.id}`, ownerLock, 8000, async () => {
       let serverState = ensureServer(serverId);
       let visitor = ensurePlayer(serverId, userId);
       let targetPlayer = ensurePlayer(serverId, targetUser.id);

      try {
        // Grant a random blessing
        const blessingType = BLESSING_TYPES[Math.floor(Math.random() * BLESSING_TYPES.length)];
        targetPlayer = grantBlessing(targetPlayer, userId, blessingType);

        // Log visit for analytics (D6)
        serverState = logVisitActivity(serverState, userId, targetUser.id);

        // Save state
        if (db) {
          upsertPlayer(db, serverId, targetUser.id, targetPlayer, null, targetPlayer.schema_version);
          upsertServer(db, serverId, serverState, null);
        }

        const blessing = getActiveBlessing(targetPlayer);
        const expiresInHours = blessing ? Math.round((blessing.expires_at - nowTs()) / (60 * 60 * 1000)) : BLESSING_DURATION_HOURS;
        const cooldownEnds = (blessing?.expires_at ?? nowTs()) + (BLESSING_COOLDOWN_HOURS * 60 * 60 * 1000);

        const blessingNames = {
          discovery_chance_add: "Enhanced Discovery",
          limited_time_window_add: "Extended Time Window",
          quality_shift: "Quality Boost",
          npc_weight_mult: "Customer Favor",
          coin_bonus: "Coin Bonus",
          rep_bonus: "Reputation Bonus"
        };
        const blessingName = blessingNames[blessingType] || blessingType;

        const embed = new EmbedBuilder()
          .setTitle("🌟 Shop Visit!")
          .setDescription(
            `<@${userId}> visited <@${targetUser.id}>'s shop and granted them a **Blessing**!\n\n` +
            `✨ **Effect**: ${blessingName}\n` +
            `⏰ **Duration**: ${expiresInHours} hours\n` +
            `🔄 **Cooldown ends**: <t:${Math.floor(cooldownEnds / 1000)}:F>`
          )
          .setColor(0xffaa00);

        applyOwnerFooter(embed, interaction.member ?? interaction.user);

      const replyObj = { 
        embeds: [embed], 
        components: [socialMainMenuRow(userId)] 
      };
        if (db) {
          putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        }
       return interaction.editReply(replyObj);
    } catch (err) {
      if (err?.code === "BLESSING_ACTIVE") {
        if (interaction.deferred || interaction.replied) {
          try {
            await interaction.deleteReply();
          } catch (e) {
            // ignore if already deleted
          }
        }
        return errorReply(interaction, "❌ They already have an active blessing.");
      }
      if (err?.code === "BLESSING_COOLDOWN" && err?.cooldownEnds) {
        const ts = Math.floor(err.cooldownEnds / 1000);
        return errorReply(interaction, `❌ Blessing cooldown active. Try again <t:${ts}:F>.`);
      }
      return errorReply(interaction, `❌ ${err.message}`);
    }
    });
  });
}

async function handleLeaderboard(interaction) {
  const serverId = interaction.guildId;
  const type = interaction.options.getString("type") || "coins";

  await interaction.deferReply({ ephemeral: false });

  try {
    // Get all players in the server
    const allPlayers = db.prepare(`
      SELECT user_id, data_json FROM players 
      WHERE server_id = ? 
      ORDER BY last_active_at DESC
      LIMIT 100
    `).all(serverId);

    if (allPlayers.length === 0) {
      return errorReply(interaction, "❌ No players found in this server yet.");
    }

    // Parse and sort
    const playerData = allPlayers.map(row => ({
      user_id: row.user_id,
      ...JSON.parse(row.data_json)
    }));

    let sortedPlayers;
    let fieldName;
    let fieldValue;

    if (type === "coins") {
      sortedPlayers = playerData.sort((a, b) => (b.coins || 0) - (a.coins || 0)).slice(0, 10);
      fieldName = "💰 Top Coin Holders";
      fieldValue = player => `${player.coins || 0}c`;
    } else if (type === "rep") {
      sortedPlayers = playerData.sort((a, b) => (b.rep || 0) - (a.rep || 0)).slice(0, 10);
      fieldName = "⭐ Top Reputation";
      fieldValue = player => `${player.rep || 0} REP`;
    } else if (type === "bowls") {
      sortedPlayers = playerData.sort((a, b) => (b.lifetime?.bowls_served_total || 0) - (a.lifetime?.bowls_served_total || 0)).slice(0, 10);
      fieldName = "🍜 Most Bowls Served";
      fieldValue = player => `${player.lifetime?.bowls_served_total || 0} bowls`;
    } else {
      return errorReply(interaction, "❌ Unknown leaderboard type.");
    }

    const leaderboardText = sortedPlayers
      .map((p, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        return `${medal} <@${p.user_id}> — ${fieldValue(p)}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("📊 Noodle Story Leaderboard")
      .setDescription(`**${fieldName}**\n\n${leaderboardText}`)
      .setColor(0x00aaff)
      .setFooter({ text: `${ownerFooterText(interaction.member ?? interaction.user)} • Rankings are read-only and for fun!` });

    return interaction.editReply({ 
      embeds: [embed], 
      components: [socialMainMenuRow(interaction.user.id)] 
    });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return errorReply(interaction, `❌ Error loading leaderboard: ${err.message}`);
  }
}

async function handleStats(interaction) {
  const serverId = interaction.guildId;
  const userId = interaction.user.id;

  await interaction.deferReply({ ephemeral: false });

  try {
    const player = ensurePlayer(serverId, userId);
    const tipStats = getUserTipStats(db, serverId, userId);
    const party = getUserActiveParty(db, userId);
    const blessing = getActiveBlessing(player);

    const embed = new EmbedBuilder()
      .setTitle("📊 Your Social Stats")
      .setColor(0x00ff88);

    applyOwnerFooter(embed, interaction.member ?? interaction.user);

    // Tips
    embed.addFields({
      name: "💰 Tips",
      value: `Sent: ${tipStats.sent.count} tips (${tipStats.sent.total}c)\nReceived: ${tipStats.received.count} tips (${tipStats.received.total}c)`,
      inline: false
    });

    // Party
    if (party) {
      const memberInfo = party.members.find(m => m.user_id === userId);
      embed.addFields({
        name: "🎪 Party",
        value: `**${party.party_name}**\nYour contributions: ${memberInfo?.contribution_points || 0} points`,
        inline: false
      });
    } else {
      embed.addFields({
        name: "🎪 Party",
        value: "Not in a party",
        inline: false
      });
    }

    // Blessing
    if (blessing) {
      const remainingMs = blessing.expires_at - nowTs();
      const remainingHours = Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
      const blessingNames = {
          discovery_chance_add: "Enhanced Discovery",
          limited_time_window_add: "Extended Time Window",
          quality_shift: "Quality Boost",
          npc_weight_mult: "Customer Favor",
        coin_bonus: "Coin Bonus",
        rep_bonus: "Reputation Bonus"
      };
      const blessingName = blessingNames[blessing.type] || blessing.type;
      embed.addFields({
        name: "✨ Active Blessing",
        value: `**${blessingName}**\nExpires in: ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`,
        inline: false
      });
    } else {
      embed.addFields({
        name: "✨ Active Blessing",
        value: "None",
        inline: false
      });
    }

    return interaction.editReply({ 
      embeds: [embed], 
      components: [socialMainMenuRow(userId)] 
    });
  } catch (err) {
    console.error("Stats error:", err);
    return errorReply(interaction, `❌ Error loading stats: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Component (Button) Handler                                         */
/* ------------------------------------------------------------------ */

async function handleComponent(interaction) {
  const customId = String(interaction.customId || "");
  const serverId = interaction.guildId;
  
  if (!serverId) {
    return componentCommit(interaction, { 
      content: "This game runs inside a server (not DMs).", 
      ephemeral: false 
    });
  }

  const userId = interaction.user.id;

  /* ---------------- MODAL HANDLERS (checked first) ---------------- */
  if (interaction.isModalSubmit?.()) {
    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferReply({ ephemeral: false });
      } catch (err) {
        // If defer fails, fall through and let reply errors surface
      }
    }
    if (customId.startsWith("noodle-social:modal:create_party:")) {
      const parts = customId.split(":");
      const sourceMessageId = parts[4] && parts[4] !== "none" ? parts[4] : null;
      const partyName = interaction.fields.getTextInputValue("party_name");
      
      if (!partyName || partyName.trim().length === 0) {
        return errorReply(interaction, "❌ Party name cannot be empty.");
      }
      const cleanedName = partyName.trim().replace(/\s+/g, " ");
      if (containsProfanity(cleanedName)) {
        return errorReply(interaction, "❌ Party name contains blocked words. Please keep it friendly.");
      }

      const ownerLock = `discord:${interaction.id}`;
      if (!db) {
        return errorReply(interaction, "Database unavailable in this environment.");
      }
      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        try {
          const result = createParty(db, serverId, userId, cleanedName);

          const embed = new EmbedBuilder()
            .setTitle("🎉 Party Created!")
            .setDescription(`You've created the party **${result.partyName}**`)
            .addFields(
              { name: "Party ID", value: `\`\`\`${formatPartyId(result.partyId)}\`\`\``, inline: true },
              { name: "Leader", value: `<@${userId}>`, inline: true }
            )
            .setColor(0x00ff00);

          applyOwnerFooter(embed, interaction.member ?? interaction.user);
          const replyObj = {
            embeds: [embed],
            components: [partyActionRow(userId, true, true, false), socialMainMenuRow(userId)]
          };

          if (sourceMessageId && interaction.channel?.messages) {
            try {
              const msg = await interaction.channel.messages.fetch(sourceMessageId);
              await msg.edit(replyObj);
              await interaction.deleteReply().catch(() => {});
              return;
            } catch (e) {
              // fallback to editing interaction reply
            }
          }

          return interaction.editReply(replyObj);
        } catch (err) {
          return errorReply(interaction, `❌ ${err.message}`);
        }
      });
    }

    if (customId.startsWith("noodle-social:modal:join_party:")) {
      const parts = customId.split(":");
      const ownerId = parts[3];
      const sourceMessageId = parts[4] && parts[4] !== "none" ? parts[4] : null;

      if (ownerId && ownerId !== userId) {
        return errorReply(interaction, "That party join prompt isn’t for you.");
      }

      const partyId = interaction.fields.getTextInputValue("party_id");

      if (!partyId || partyId.trim().length === 0) {
        return errorReply(interaction, "❌ Party ID cannot be empty.");
      }

      const ownerLock = `discord:${interaction.id}`;
      if (!db) {
        return errorReply(interaction, "Database unavailable in this environment.");
      }
      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        try {
          const result = joinParty(db, serverId, partyId, userId);
          
          const embed = new EmbedBuilder()
            .setTitle("🎊 Joined Party!")
            .setDescription(`You've joined the party **${result.partyName}**`)
            .setColor(0x00ff00);

          applyOwnerFooter(embed, interaction.member ?? interaction.user);

          if (sourceMessageId && interaction.channel?.messages) {
            try {
              const msg = await interaction.channel.messages.fetch(sourceMessageId);
              await msg.edit({
                embeds: [embed],
                components: [partyActionRow(userId, true, false, false), socialMainMenuRow(userId)]
              });
              await interaction.deleteReply().catch(() => {});
              return;
            } catch (e) {
              // fallback to editing interaction reply
            }
          }

          return interaction.editReply({ 
            embeds: [embed], 
            components: [partyActionRow(userId, true, false, false), socialMainMenuRow(userId)] 
          });
        } catch (err) {
          return errorReply(interaction, `❌ ${err.message}`);
        }
      });
    }

    if (customId.startsWith("noodle-social:modal:invite_user:")) {
      const nameInput = interaction.fields.getTextInputValue("name");

      if (!nameInput || nameInput.trim().length === 0) {
        return errorReply(interaction, "❌ Name cannot be empty.");
      }

      const searchName = nameInput.trim().toLowerCase();
      const ownerLock = `discord:${interaction.id}`;

      try {
        if (!db) {
          return errorReply(interaction, "Database unavailable in this environment.");
        }
        return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
          try {
            // Only allow inviting users in this server
            const guild = interaction.guild;
            if (!guild) {
              return errorReply(interaction, "❌ This command only works in a server.");
            }

            let targetMember = null;
            
            // Search guild cache first
            for (const member of guild.members.cache.values()) {
              const nickname = member.nickname?.toLowerCase();
              const username = member.user.username?.toLowerCase();
              const displayName = member.displayName?.toLowerCase();
              const globalName = member.user.globalName?.toLowerCase();
              
              if (nickname === searchName || username === searchName || displayName === searchName || globalName === searchName) {
                console.log(`✅ Found user in cache: ${member.displayName}`);
                targetMember = member;
                break;
              }
            }

            // If not in cache, try to search with a query (limited fetch)
            if (!targetMember) {
              try {
                console.log(`🔍 Searching for user: ${searchName}`);
                const searchResults = await guild.members.search({ query: searchName, limit: 10 });
                console.log(`📋 Found ${searchResults.size} search results`);
                if (searchResults.size > 0) {
                  targetMember = searchResults.first();
                  console.log(`✅ Found via search: ${targetMember.displayName}`);
                }
              } catch (e) {
                console.log(`⚠️ Member search failed:`, e?.message);
              }
            }

            if (!targetMember) {
              return errorReply(interaction, `❌ User **${searchName}** not found. Make sure they're in this server and try their exact username or nickname.`);
            }
            const inviteTargetId = targetMember.user.id;
            const currentParty = getUserActiveParty(db, userId);
            if (!currentParty) {
              return errorReply(interaction, "❌ You're not in a party anymore.");
            }

            console.log(`🎪 Inviting to party: ${currentParty.party_name}`);
            const result = inviteUserToParty(db, serverId, currentParty.party_id, inviteTargetId);
            console.log(`✅ Invite successful, sending response`);
            
            const embed = new EmbedBuilder()
              .setTitle("✅ User Invited!")
              .setDescription(`**${targetMember.displayName}** has been invited to **${result.partyName}**`)
              .setColor(0x00ff00);

            applyOwnerFooter(embed, interaction.member ?? interaction.user);

            const existingOrder = getActiveSharedOrderByParty(db, currentParty.party_id);
            return interaction.editReply({ 
              embeds: [embed], 
              components: [partyActionRow(userId, true, true, !!existingOrder), socialMainMenuRow(userId)] 
            });
          } catch (err) {
            console.error(`❌ Error in invite handler:`, err);
            return errorReply(interaction, `❌ ${err.message}`);
          }
        });
      } catch (err) {
        console.error(`❌ withLock failed:`, err);
        try {
          return errorReply(interaction, `❌ ${err.message}`);
        } catch (e) {
          console.log(`⚠️ editReply also failed:`, e?.message);
        }
      }
    }

    if (customId.startsWith("noodle-social:modal:tip:")) {
      const parts = customId.split(":");
      const sourceMessageId = parts[4] && parts[4] !== "none" ? parts[4] : null;
      const targetInput = interaction.fields.getTextInputValue("target_user");
      const amountInput = interaction.fields.getTextInputValue("amount");

      const targetId = await resolveUserIdFromInput(targetInput, interaction);
      if (!targetId) {
        return errorReply(interaction, "❌ Enter a nickname or username.");
      }
      if (targetId === userId) {
        return errorReply(interaction, "❌ You cannot tip yourself!");
      }

      const amount = Number.parseInt(String(amountInput ?? "").trim(), 10);
      if (!Number.isFinite(amount)) {
        return errorReply(interaction, "❌ Enter a valid amount.");
      }

      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      if (!targetUser) {
        return errorReply(interaction, "❌ User not found.");
      }

      const ownerLock = `discord:${interaction.id}`;

      if (!db) {
        return errorReply(interaction, "Database unavailable in this environment.");
      }
      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        return await withLock(db, `lock:user:${targetId}`, ownerLock, 8000, async () => {
          let sender = ensurePlayer(serverId, userId);
          let receiver = ensurePlayer(serverId, targetId);

          try {
            const result = transferTip(db, serverId, sender, receiver, amount, null);

            if (db) {
              upsertPlayer(db, serverId, userId, result.sender, null, result.sender.schema_version);
              upsertPlayer(db, serverId, targetId, result.receiver, null, result.receiver.schema_version);
            }

            const party = getUserActiveParty(db, userId);
            const isLeader = party?.leader_user_id === userId;
            const existingOrder = party ? getActiveSharedOrderByParty(db, party.party_id) : null;
            const partyRow = party ? partyActionRow(userId, true, isLeader, !!existingOrder) : partyCreationRow(userId);

            const embed = new EmbedBuilder()
              .setTitle("💰 Tip Sent!")
              .setDescription(`<@${userId}> tipped <@${targetId}> **${amount}c**!`)
              .setColor(0xffd700);

            embed.addFields(
              { name: "Your Balance", value: `${result.sender.coins}c`, inline: true },
              { name: "Their Balance", value: `${result.receiver.coins}c`, inline: true }
            );

            applyOwnerFooter(embed, interaction.member ?? interaction.user);

            return componentCommit(interaction, {
              embeds: [embed],
              components: [partyRow, socialMainMenuRow(userId)],
              targetMessageId: sourceMessageId
            });
          } catch (err) {
            return errorReply(interaction, `❌ ${err.message}`);
          }
        });
      });
    }

    if (customId.startsWith("noodle-social:modal:bless:")) {
      const parts = customId.split(":");
      const sourceMessageId = parts[4] && parts[4] !== "none" ? parts[4] : null;
      const targetInput = interaction.fields.getTextInputValue("target_user");
      const targetId = await resolveUserIdFromInput(targetInput, interaction);
      if (!targetId) {
        return componentCommit(interaction, { content: "❌ Enter a nickname or username.", ephemeral: true });
      }
      if (targetId === userId) {
        return componentCommit(interaction, { content: "❌ You cannot bless yourself!", ephemeral: true });
      }

      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      if (!targetUser) {
        return componentCommit(interaction, { content: "❌ User not found.", ephemeral: true });
      }

      const ownerLock = `discord:${interaction.id}`;
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }
      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        return await withLock(db, `lock:user:${targetId}`, ownerLock, 8000, async () => {
          let serverState = ensureServer(serverId);
          let targetPlayer = ensurePlayer(serverId, targetId);

          try {
            const blessingType = BLESSING_TYPES[Math.floor(Math.random() * BLESSING_TYPES.length)];
            targetPlayer = grantBlessing(targetPlayer, userId, blessingType);

            serverState = logVisitActivity(serverState, userId, targetId);

            if (db) {
              upsertPlayer(db, serverId, targetId, targetPlayer, null, targetPlayer.schema_version);
              upsertServer(db, serverId, serverState, null);
            }

            const blessing = getActiveBlessing(targetPlayer);
            const expiresInHours = blessing ? Math.round((blessing.expires_at - nowTs()) / (60 * 60 * 1000)) : BLESSING_DURATION_HOURS;
            const cooldownEnds = (blessing?.expires_at ?? nowTs()) + (BLESSING_COOLDOWN_HOURS * 60 * 60 * 1000);
            const blessingNames = {
              discovery_chance_add: "Enhanced Discovery",
              limited_time_window_add: "Extended Time Window",
              quality_shift: "Quality Boost",
              npc_weight_mult: "Customer Favor",
              coin_bonus: "Coin Bonus",
              rep_bonus: "Reputation Bonus"
            };
            const blessingName = blessingNames[blessingType] || blessingType;

            const party = getUserActiveParty(db, userId);
            const isLeader = party?.leader_user_id === userId;
            const existingOrder = party ? getActiveSharedOrderByParty(db, party.party_id) : null;
            const partyRow = party ? partyActionRow(userId, true, isLeader, !!existingOrder) : partyCreationRow(userId);

            const embed = new EmbedBuilder()
              .setTitle("🌟 Blessing Granted!")
              .setDescription(
                `<@${userId}> blessed <@${targetId}>!\n\n` +
                `✨ **Effect**: ${blessingName}\n` +
                `⏰ **Duration**: ${expiresInHours} hours\n` +
                `🔄 **Cooldown ends**: <t:${Math.floor(cooldownEnds / 1000)}:F>`
              )
              .setColor(0xffaa00);

            applyOwnerFooter(embed, interaction.member ?? interaction.user);

            return componentCommit(interaction, {
              embeds: [embed],
              components: [partyRow, socialMainMenuRow(userId)],
              targetMessageId: sourceMessageId
            });
          } catch (err) {
            if (err?.code === "BLESSING_ACTIVE") {
              return componentCommit(interaction, { content: "❌ They already have an active blessing.", ephemeral: true });
            }
            if (err?.code === "BLESSING_COOLDOWN" && err?.cooldownEnds) {
              const ts = Math.floor(err.cooldownEnds / 1000);
              return componentCommit(interaction, { content: `❌ Blessing cooldown active. Try again <t:${ts}:F>.`, ephemeral: true });
            }
            return componentCommit(interaction, { content: `❌ ${err.message}`, ephemeral: true });
          }
        });
      });
    }

    // Removed old modal handler - now using select menus for shared orders

    if (customId.startsWith("noodle-social:modal:contribute_shared_order_qty:")) {


      const parts2 = customId.split(":");
      const ownerId = parts2[3];
      const sourceMessageId = parts2[4] && parts2[4] !== "none" ? parts2[4] : null;
      const ingredientId = parts2.slice(5).join(":");

      if (ownerId && ownerId !== userId) {
        return componentCommit(interaction, { content: "That contribution prompt isn’t for you.", ephemeral: true });
      }

      const quantityInput = interaction.fields.getTextInputValue("quantity");
      const quantity = Number.parseInt(String(quantityInput ?? "").trim(), 10);
      if (!Number.isFinite(quantity) || quantity < 1) {
        return componentCommit(interaction, { content: "❌ Quantity must be at least 1.", ephemeral: true });
      }

      const ingredient = content.items[ingredientId];
      if (!ingredient) {
        return componentCommit(interaction, { content: "❌ Ingredient not found.", ephemeral: true });
      }

      const ownerLock = `discord:${interaction.id}`;
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }
      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        try {
          const party = getUserActiveParty(db, userId);
          if (!party) {
            return componentCommit(interaction, { content: "❌ You're not in a party.", ephemeral: true });
          }

          const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
          if (!sharedOrder) {
            return componentCommit(interaction, { content: "❌ No active shared order.", ephemeral: true });
          }

          const recipe = content.recipes[sharedOrder.order_id];
          if (!recipe) {
            return componentCommit(interaction, { content: "❌ Recipe not found.", ephemeral: true });
          }

          const contributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
          const progress = buildSharedOrderProgress({
            recipe,
            servings: sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
            contributions
          });

          const selected = progress.items.find((i) => i.ingredientId === ingredientId);
          if (!selected || selected.remaining <= 0) {
            return componentCommit(interaction, { content: "✅ That ingredient is already covered.", ephemeral: true });
          }

          if (quantity > selected.remaining) {
            return componentCommit(interaction, { content: `❌ Max remaining is ${selected.remaining}.`, ephemeral: true });
          }

          const player = ensurePlayer(serverId, userId);
          const owned = player.inv_ingredients?.[ingredientId] ?? 0;
          if (owned < quantity) {
            return componentCommit(interaction, { content: `❌ You only have ${owned}.`, ephemeral: true });
          }

          player.inv_ingredients[ingredientId] = owned - quantity;
          if (db) {
            upsertPlayer(db, serverId, userId, player, null, player.schema_version);
          }

          // Contribute to shared order
          contributeToSharedOrder(db, sharedOrder.shared_order_id, userId, ingredientId, quantity);

          const embed = new EmbedBuilder()
            .setTitle("✅ Contribution Recorded!")
            .setDescription(
              `You contributed **${quantity}x ${ingredient.name}** to the shared order.\n\n` +
              `Thank you for helping the party! 🎪`
            )
            .setColor(0x00ff88);

          applyOwnerFooter(embed, interaction.member ?? interaction.user);

          const isLeader = party.leader_user_id === userId;
          const updatedContributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
          const updatedProgress = buildSharedOrderProgress({
            recipe,
            servings: sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
            contributions: updatedContributions
          });

          return componentCommit(interaction, {
            embeds: [embed],
            components: [sharedOrderActionRow(userId, true, isLeader, updatedProgress.isComplete), socialMainMenuRow(userId)],
            targetMessageId: sourceMessageId
          });
        } catch (err) {
          return componentCommit(interaction, { content: `❌ ${err.message}`, ephemeral: true });
        }
      });
    }
  }

  const parts = customId.split(":"); // noodle-social:<kind>:<action>:<ownerId>

  if (parts[0] !== "noodle-social") {
    return componentCommit(interaction, { 
      content: "Unknown component.", 
      ephemeral: true 
    });
  }

  const kind = parts[1] ?? "";
  const action = parts[2] ?? "";
  const ownerId = parts[3] ?? "";

  // Lock UI to owner when ownerId is present
  if (ownerId && ownerId !== userId) {
    return componentCommit(interaction, { 
      content: "That menu isn't for you.", 
      ephemeral: true 
    });
  }

  /* ---------------- SELECT MENUS ---------------- */
  if (kind === "select") {
    if (action === "shared_order_recipe") {
      const selectedRecipe = interaction.values?.[0];
      if (!selectedRecipe || !content.recipes[selectedRecipe]) {
        return componentCommit(interaction, {
          content: "❌ Invalid recipe selection.",
          ephemeral: true
        });
      }

      // Show servings picker
      const servingOptions = [
        { label: "5 servings", value: "5", description: "Minimum for shared orders" },
        { label: "10 servings", value: "10", description: "Good for medium parties" },
        { label: "15 servings", value: "15", description: "Great for larger groups" },
        { label: "20 servings", value: "20", description: "Maximum team effort!" }
      ];

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`noodle-social:select:shared_order_confirm:${userId}:${selectedRecipe}`)
        .setPlaceholder("Choose how many servings to make")
        .addOptions(servingOptions);

      const recipe = content.recipes[selectedRecipe];
      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle-social:action:shared_order:${userId}`)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary)
      );

      const servingsEmbed = new EmbedBuilder()
        .setTitle("🍜 Create Shared Order")
        .setDescription(`**Recipe**: ${recipe.name}\n\nStep 2: How many servings should your party make?`)
        .setColor(0x00aeff);

      applyOwnerFooter(servingsEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [servingsEmbed],
        components: [new ActionRowBuilder().addComponents(menu), backRow]
      });
    }

    if (action === "shared_order_confirm") {
      const recipeId = parts[4];
      const selectedServings = interaction.values?.[0];
      const servings = Number.parseInt(selectedServings, 10);

      if (!recipeId || !content.recipes[recipeId] || !Number.isFinite(servings)) {
        return componentCommit(interaction, {
          content: "❌ Invalid selection.",
          ephemeral: true
        });
      }

      const recipe = content.recipes[recipeId];
      const ownerLock = `discord:${interaction.id}`;

      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        try {
          const party = getUserActiveParty(db, userId);
          if (!party) {
            return componentCommit(interaction, { content: "❌ You're not in a party.", ephemeral: true });
          }

          if (party.leader_user_id !== userId) {
            return componentCommit(interaction, { content: "❌ Only the party leader can create shared orders.", ephemeral: true });
          }

          // Check if there's already an active shared order
          const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
          if (existingOrder) {
            return componentCommit(interaction, { 
              content: "❌ Your party already has an active shared order. Complete it first.", 
              ephemeral: true 
            });
          }

          // Create the shared order
          const result = createSharedOrder(db, party.party_id, recipeId, serverId, servings);

          const ingredientList = recipe.ingredients
            .map(ing => `• ${content.items[ing.item_id]?.name || ing.item_id} × ${ing.qty * servings}`)
            .join("\n");

            const totalReward = servings * SHARED_ORDER_REWARD.coinsPerServing;
          const embed = new EmbedBuilder()
            .setTitle("🍜 Shared Order Created!")
            .setDescription(
              `**${recipe.name}**\n\n` +
              `📦 **Servings**: ${servings}\n` +
                `💰 **Reward**: ${totalReward}c (${SHARED_ORDER_REWARD.coinsPerServing}c per serving)\n` +
              `👥 **Ingredients Needed**:\n${ingredientList}`
            )
            .addFields({
              name: "💡 How It Works",
              value: "Party members tap **Contribute** to add ingredients. When complete, everyone who helped gets rewarded!",
              inline: false
            })
            .setColor(0x00ff88);

          applyOwnerFooter(embed, interaction.member ?? interaction.user);

          const isLeader = party.leader_user_id === userId;
          return componentCommit(interaction, {
            embeds: [embed],
            components: [partyActionRow(userId, true, isLeader, true), socialMainMenuRow(userId)]
          });
        } catch (err) {
          return componentCommit(interaction, { content: `❌ ${err.message}`, ephemeral: true });
        }
      });
    }

    if (action === "shared_order_ingredient") {
      const ingredientId = interaction.values?.[0];

      if (!ingredientId) {
        return componentCommit(interaction, { content: "❌ Invalid selection.", ephemeral: true });
      }

      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, { content: "❌ You're not in a party.", ephemeral: true });
      }

      const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (!sharedOrder) {
        return componentCommit(interaction, { content: "❌ No active shared order.", ephemeral: true });
      }

      const recipe = content.recipes[sharedOrder.order_id];
      if (!recipe) {
        return componentCommit(interaction, { content: "❌ Recipe not found.", ephemeral: true });
      }

      const contributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
      const progress = buildSharedOrderProgress({
        recipe,
        servings: sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
        contributions
      });

      const selected = progress.items.find((i) => i.ingredientId === ingredientId);
      if (!selected || selected.remaining <= 0) {
        return componentCommit(interaction, { content: "✅ That ingredient is already covered.", ephemeral: true });
      }

      const sourceMessageId = interaction.message?.id ?? "none";
      const modal = new ModalBuilder()
        .setCustomId(`noodle-social:modal:contribute_shared_order_qty:${userId}:${sourceMessageId}:${ingredientId}`)
        .setTitle("Contribute Ingredient");

      const input = new TextInputBuilder()
        .setCustomId("quantity")
        .setLabel(`Quantity (max ${selected.remaining})`)
        .setStyle(1)
        .setRequired(true)
        .setPlaceholder("1");

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      try {
        return await interaction.showModal(modal);
      } catch (e) {
        console.log(`⚠️ showModal failed for shared_order_contribute:`, e?.message);
        return componentCommit(interaction, {
          content: "⚠️ Discord couldn't show the modal.",
          ephemeral: true
        });
      }
    }
  }

  /* ---------------- NAV BUTTONS ---------------- */
  if (kind === "nav") {
    // Navigate to different social views
    if (action === "party") {
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }
      const party = getUserActiveParty(db, userId);
      if (!party) {
        const embed = new EmbedBuilder()
          .setTitle("🎪 Party")
          .setDescription("You're not in any party. Create or join one!")
          .setColor(0x00aeff);
        applyOwnerFooter(embed, interaction.member ?? interaction.user);
        return componentCommit(interaction, {
          content: " ",
          embeds: [embed],
          components: [partyCreationRow(userId), socialMainMenuRow(userId)],
          ephemeral: false
        });
      }

      const memberList = party.members
        .map((m, i) => `${i + 1}. <@${m.user_id}> (${m.contribution_points} points)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎪 ${party.party_name}`)
        .setDescription(`Party ID:\n\`\`\`${formatPartyId(party.party_id)}\`\`\``)
        .addFields(
          { name: "Leader", value: `<@${party.leader_user_id}>`, inline: true },
          { name: "Members", value: `${party.members.length}/${party.max_members}`, inline: true },
          { name: "Member List", value: memberList || "No members", inline: false }
        )
        .setColor(0x00aeff);

      applyOwnerFooter(embed, interaction.member ?? interaction.user);

      applyOwnerFooter(embed, interaction.member ?? interaction.user);

      const isLeader = party.leader_user_id === userId;
      const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (existingOrder) {
        const recipe = content.recipes?.[existingOrder.order_id];
        const recipeName = recipe?.name ?? existingOrder.order_id;
        const servings = existingOrder.servings ?? SHARED_ORDER_MIN_SERVINGS;
        embed.addFields({
          name: "\n🍜 Shared Order",
          value: `Active — **${recipeName}** (${servings} servings)`,
          inline: false
        });
      } else {
        embed.addFields({
          name: "\n🍜 Shared Order",
          value: "None active.",
          inline: false
        });
      }
      return componentCommit(interaction, {
        embeds: [embed],
        components: [partyActionRow(userId, true, isLeader, !!existingOrder), socialMainMenuRow(userId)]
      });
    }

    if (action === "leaderboard") {
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }
      // Show leaderboard
      const allPlayers = db.prepare(`
        SELECT user_id, data_json FROM players 
        WHERE server_id = ? 
        ORDER BY last_active_at DESC
        LIMIT 100
      `).all(serverId);

      if (allPlayers.length === 0) {
        return componentCommit(interaction, {
          content: "❌ No players found in this server yet.",
          ephemeral: false
        });
      }

      const playerData = allPlayers.map(row => ({
        user_id: row.user_id,
        ...JSON.parse(row.data_json)
      }));

      const sortedPlayers = playerData.sort((a, b) => (b.coins || 0) - (a.coins || 0)).slice(0, 10);
      const leaderboardText = sortedPlayers
        .map((p, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          return `${medal} <@${p.user_id}> — ${p.coins || 0}c`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("📊 Noodle Story Leaderboard")
        .setDescription(`**💰 Top Coin Holders**\n\n${leaderboardText}`)
        .setColor(0x00aaff)
        .setFooter({ text: `${ownerFooterText(interaction.member ?? interaction.user)} • Rankings are read-only and for fun!` });

      return componentCommit(interaction, {
        embeds: [embed],
        components: [socialMainMenuRow(userId)]
      });
    }

    if (action === "stats") {
      const player = ensurePlayer(serverId, userId);
      const tipStats = getUserTipStats(db, serverId, userId);
      const party = getUserActiveParty(db, userId);
      const blessing = getActiveBlessing(player);

      const embed = new EmbedBuilder()
        .setTitle("📊 Your Social Stats")
        .setColor(0x00ff88);

      applyOwnerFooter(embed, interaction.member ?? interaction.user);

      embed.addFields({
        name: "💰 Tips",
        value: `Sent: ${tipStats.sent.count} tips (${tipStats.sent.total}c)\nReceived: ${tipStats.received.count} tips (${tipStats.received.total}c)`,
        inline: false
      });

      if (party) {
        const memberInfo = party.members.find(m => m.user_id === userId);
        embed.addFields({
          name: "🎪 Party",
          value: `**${party.party_name}**\nYour contributions: ${memberInfo?.contribution_points || 0} points`,
          inline: false
        });
      } else {
        embed.addFields({
          name: "🎪 Party",
          value: "Not in a party",
          inline: false
        });
      }

      if (blessing) {
        const remainingMs = blessing.expires_at - nowTs();
        const remainingHours = Math.max(0, Math.ceil(remainingMs / (60 * 60 * 1000)));
        const blessingNames = {
          discovery_chance_add: "Enhanced Discovery",
          limited_time_window_add: "Extended Time Window",
          quality_shift: "Quality Boost",
          npc_weight_mult: "Customer Favor",
          coin_bonus: "Coin Bonus",
          rep_bonus: "Reputation Bonus"
        };
        const blessingName = blessingNames[blessing.type] || blessing.type;
        embed.addFields({
          name: "✨ Active Blessing",
          value: `**${blessingName}**\nExpires in: ${remainingHours} hour${remainingHours !== 1 ? "s" : ""}`,
          inline: false
        });
      } else {
        embed.addFields({
          name: "✨ Active Blessing",
          value: "None",
          inline: false
        });
      }

      return componentCommit(interaction, {
        embeds: [embed],
        components: statsViewButtons(userId)
      });
    }

    if (action === "profile") {
      const player = ensurePlayer(serverId, userId);
      const party = getUserActiveParty(db, userId);

      const embed = renderProfileEmbed(
        player,
        interaction.member?.displayName ?? interaction.user?.username,
        party?.party_name,
        interaction.member ?? interaction.user
      );

      return componentCommit(interaction, {
        embeds: [embed],
        components: [noodleMainMenuRowNoProfile(userId), socialMainMenuRowNoProfile(userId)]
      });
    }
  }

  /* ---------------- ACTION BUTTONS ---------------- */
  if (kind === "action") {
    if (action === "tip") {
      if (interaction.deferred || interaction.replied) {
        return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
      }

      try {
        const sourceMessageId = interaction.message?.id ?? "none";
        return await interaction.showModal({
          customId: `noodle-social:modal:tip:${userId}:${sourceMessageId}`,
          title: "Send a Tip",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  customId: "target_user",
                  label: "Nickname or username",
                  style: 1,
                  required: true,
                  maxLength: 32
                }
              ]
            },
            {
              type: 1,
              components: [
                {
                  type: 4,
                  customId: "amount",
                  label: "Amount (coins up to 100)",
                  style: 1,
                  required: true,
                  maxLength: 8
                }
              ]
            }
          ]
        });
      } catch (e) {
        console.log(`⚠️ showModal failed for tip:`, e?.message);
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal.", 
          ephemeral: true 
        });
      }
    }

    if (action === "bless") {
      if (interaction.deferred || interaction.replied) {
        return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
      }

      try {
        const sourceMessageId = interaction.message?.id ?? "none";
        return await interaction.showModal({
          customId: `noodle-social:modal:bless:${userId}:${sourceMessageId}`,
          title: "Grant a Blessing",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  customId: "target_user",
                  label: "Nickname or username",
                  style: 1,
                  required: true,
                  maxLength: 32
                }
              ]
            }
          ]
        });
      } catch (e) {
        console.log(`⚠️ showModal failed for bless:`, e?.message);
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal.", 
          ephemeral: true 
        });
      }
    }

    if (action === "shared_order") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
      const hasActiveOrder = !!existingOrder;
      const isLeader = party.leader_user_id === userId;
      let canComplete = false;
      let embed = null;

      if (existingOrder) {
        const recipe = content.recipes[existingOrder.order_id];
        if (recipe) {
          const contributions = getSharedOrderContributions(db, existingOrder.shared_order_id);
          const progress = buildSharedOrderProgress({
            recipe,
            servings: existingOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
            contributions
          });
          canComplete = progress.isComplete;

          // Build ingredient progress display
          const ingredientLines = progress.items.map(item => {
            const itemData = content.items[item.ingredientId];
            const itemName = itemData?.name || `Item #${item.ingredientId}`;
            const bar = item.remaining > 0 
              ? `[${item.contributed}/${item.required}]` 
              : `✅ [${item.required}/${item.required}]`;
            return `${itemName} ${bar}`;
          }).join('\n');

          embed = new EmbedBuilder()
            .setTitle(`🍜 ${recipe.name}`)
            .setDescription(`**Servings**: ${existingOrder.servings ?? SHARED_ORDER_MIN_SERVINGS}`)
            .addFields(
              {
                name: "📦 Ingredients",
                value: ingredientLines || "No ingredients",
                inline: false
              }
            )
            .setColor(canComplete ? 0x00ff00 : 0xffaa00)
            .setFooter({ text: `${ownerFooterText(interaction.member ?? interaction.user)} • ${canComplete ? "✅ Ready to complete!" : "⏳ In progress..."}` });
        }
      }

      const replyObj = {
        components: [sharedOrderActionRow(userId, hasActiveOrder, isLeader, canComplete), socialMainMenuRow(userId)]
      };

      if (embed) {
        replyObj.embeds = [embed];
      } else {
        const emptyEmbed = new EmbedBuilder()
          .setTitle("🍜 Shared Order")
          .setDescription(
            isLeader
              ? "No active order. Click **Create Shared Order** to start one."
              : "No active order yet. Ask your party leader to create one!"
          )
          .setColor(0xffaa00);

        applyOwnerFooter(emptyEmbed, interaction.member ?? interaction.user);

        replyObj.embeds = [emptyEmbed];
      }

      return componentCommit(interaction, replyObj);
    }

    if (action === "shared_order_create") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      if (party.leader_user_id !== userId) {
        return componentCommit(interaction, {
          content: "❌ Only the party leader can create shared orders.",
          ephemeral: true
        });
      }

      const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (existingOrder) {
        return componentCommit(interaction, {
          content: "❌ Your party already has an active shared order.",
          ephemeral: true
        });
      }

      // Get recipes known by party members
      const partyMemberIds = party.members.map(m => m.user_id);
      const knownRecipeIds = new Set();
    
      for (const memberId of partyMemberIds) {
        const memberPlayer = getPlayer(db, serverId, memberId);
        if (memberPlayer && Array.isArray(memberPlayer.known_recipes)) {
          memberPlayer.known_recipes.forEach(recipeId => knownRecipeIds.add(recipeId));
        }
      }

      // Show recipe picker (only recipes known by party members)
      const recipeOptions = Object.entries(content.recipes)
        .filter(([id]) => knownRecipeIds.has(id))
        .slice(0, 25) // Discord limit
        .map(([id, recipe]) => ({
          label: recipe.name.length > 100 ? recipe.name.slice(0, 97) + "..." : recipe.name,
          value: id,
          description: `${recipe.ingredients.length} ingredients`
        }));

      if (!recipeOptions.length) {
        return componentCommit(interaction, {
          content: "❌ No recipes available. Party members need to unlock recipes first!",
          ephemeral: true
        });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`noodle-social:select:shared_order_recipe:${userId}`)
        .setPlaceholder("Choose a recipe for the shared order")
        .addOptions(recipeOptions);

      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`noodle-social:action:shared_order:${userId}`)
          .setLabel("Back")
          .setStyle(ButtonStyle.Secondary)
      );

      const createEmbed = new EmbedBuilder()
        .setTitle("🍜 Create Shared Order")
        .setDescription("Step 1: Pick a recipe that your party members know.")
        .setColor(0x00aeff);

      applyOwnerFooter(createEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [createEmbed],
        components: [new ActionRowBuilder().addComponents(menu), backRow]
      });
    }

    if (action === "party_info") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in any party.",
          embeds: [],
          ephemeral: false
        });
      }

      const memberList = party.members
        .map((m, i) => `${i + 1}. <@${m.user_id}> (${m.contribution_points} points)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎪 ${party.party_name}`)
        .setDescription(`Party ID:\n\`\`\`${formatPartyId(party.party_id)}\`\`\``)
        .addFields(
          { name: "Leader", value: `<@${party.leader_user_id}>`, inline: true },
          { name: "Members", value: `${party.members.length}/${party.max_members}`, inline: true },
          { name: "Member List", value: memberList || "No members", inline: false }
        )
        .setColor(0x00aeff);

      return componentCommit(interaction, {
        embeds: [embed],
        components: [socialMainMenuRow(userId)]
      });
    }

    if (action === "party_leave") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return componentCommit(interaction, {
          content: "❌ You're not in any party.",
          ephemeral: false
        });
      }

      try {
        leaveParty(db, currentParty.party_id, userId);
        return componentCommit(interaction, {
          content: `✅ You've left the party **${currentParty.party_name}**.`,
          embeds: [],
          components: [socialMainMenuRow(userId)]
        });
      } catch (err) {
        return componentCommit(interaction, {
          content: `❌ ${err.message}`,
          ephemeral: true
        });
      }
    }

    if (action === "party_invite") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return componentCommit(interaction, {
          content: "❌ You're not in any party.",
          ephemeral: true
        });
      }

      if (currentParty.leader_user_id !== userId) {
        return componentCommit(interaction, {
          content: "❌ Only the party leader can invite members.",
          ephemeral: true
        });
      }

      try {
        return await interaction.showModal({
          customId: `noodle-social:modal:invite_user:${userId}`,
          title: "Invite User to Party",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  customId: "name",
                  label: "Nickname or Username",
                  style: 1,
                  required: true,
                  maxLength: 32
                }
              ]
            }
          ]
        });
      } catch (e) {
        console.log(`⚠️ showModal failed for party_invite:`, e?.message);
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal.", 
          ephemeral: true 
        });
      }
    }

    if (action === "shared_order_contribute") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (!sharedOrder) {
        return componentCommit(interaction, {
          content: "❌ No active shared order in your party.",
          ephemeral: true
        });
      }

      const recipe = content.recipes[sharedOrder.order_id];
      if (!recipe) {
        return componentCommit(interaction, {
          content: "❌ Recipe not found.",
          ephemeral: true
        });
      }

      const contributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
      const progress = buildSharedOrderProgress({
        recipe,
        servings: sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
        contributions
      });

      const ingredientOptions = progress.items
        .filter((i) => i.remaining > 0)
        .slice(0, 25)
        .map((i) => {
          const name = content.items?.[i.ingredientId]?.name ?? i.ingredientId;
          const owned = ensurePlayer(serverId, userId).inv_ingredients?.[i.ingredientId] ?? 0;
          const labelRaw = `${name} — need ${i.remaining}`;
          return {
            label: labelRaw.length > 100 ? labelRaw.slice(0, 97) + "..." : labelRaw,
            value: i.ingredientId,
            description: `Have ${owned} · Required ${i.required}, contributed ${i.contributed}`
          };
        });

      if (!ingredientOptions.length) {
        return componentCommit(interaction, {
          content: "✅ All ingredients are already covered!",
          ephemeral: true
        });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`noodle-social:select:shared_order_ingredient:${userId}`)
        .setPlaceholder("Choose an ingredient to contribute")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(ingredientOptions);

      const isLeader = party.leader_user_id === userId;
      const contributeEmbed = new EmbedBuilder()
        .setTitle("🥕 Contribute Ingredients")
        .setDescription("Pick an ingredient to add:")
        .setColor(0x00aeff);

      applyOwnerFooter(contributeEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [contributeEmbed],
        components: [new ActionRowBuilder().addComponents(menu), sharedOrderActionRow(userId, true, isLeader, progress.isComplete), socialMainMenuRow(userId)]
      });
    }

    if (action === "shared_order_complete") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      if (party.leader_user_id !== userId) {
        return componentCommit(interaction, {
          content: "❌ Only the party leader can complete orders.",
          ephemeral: true
        });
      }

      const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (!sharedOrder) {
        return componentCommit(interaction, {
          content: "❌ No active shared order.",
          ephemeral: true
        });
      }

      const recipe = content.recipes[sharedOrder.order_id];
      if (recipe) {
        const contributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
        const progress = buildSharedOrderProgress({
          recipe,
          servings: sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
          contributions
        });

        if (!progress.isComplete) {
          return componentCommit(interaction, {
            content: "❌ The order isn’t complete yet. Add all required ingredients first.",
            ephemeral: true
          });
        }
      }

      // Confirm completion
      return componentCommit(interaction, {
        content: "⚠️ Mark this shared order as complete? This will distribute rewards to all contributors.",
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`noodle-social:action:shared_order_confirm_complete:${userId}`)
              .setLabel("✅ Confirm Complete")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`noodle-social:action:shared_order_cancel_complete:${userId}`)
              .setLabel("❌ Cancel")
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }

    if (action === "shared_order_cancel") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      if (party.leader_user_id !== userId) {
        return componentCommit(interaction, {
          content: "❌ Only the party leader can cancel shared orders.",
          ephemeral: true
        });
      }

      const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (!sharedOrder) {
        return componentCommit(interaction, {
          content: "❌ No active shared order to cancel.",
          ephemeral: true
        });
      }

      const recipe = content.recipes?.[sharedOrder.order_id];
      const promptEmbed = new EmbedBuilder()
        .setTitle("⚠️ Cancel Shared Order?")
        .setDescription(
          `${recipe?.name ? `**${recipe.name}** (${sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS} servings)\n\n` : ""}` +
          "Contributors will not receive rewards, but their ingredients will be returned."
        )
        .setColor(0xffaa00);

      applyOwnerFooter(promptEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [promptEmbed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`noodle-social:action:shared_order_confirm_cancel:${userId}`)
              .setLabel("🧹 Confirm Cancel")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`noodle-social:action:shared_order_abort_cancel:${userId}`)
              .setLabel("Keep Order")
              .setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }

    if (action === "shared_order_confirm_complete") {
      if (!interaction.deferred && !interaction.replied) {
        try {
          await interaction.deferUpdate();
        } catch (err) {
          return;
        }
      }
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }

      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      if (party.leader_user_id !== userId) {
        return componentCommit(interaction, {
          content: "❌ Only the party leader can complete orders.",
          ephemeral: true
        });
      }

      const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (!sharedOrder) {
        return componentCommit(interaction, {
          content: "❌ No active shared order.",
          ephemeral: true
        });
      }

      const ownerLock = `discord:${interaction.id}`;

      try {
        // Get recipe to determine servings
        const recipe = content.recipes[sharedOrder.order_id];
        if (!recipe) {
          return componentCommit(interaction, {
            content: "❌ Recipe not found.",
            ephemeral: true
          });
        }

        // Get contributions
        const contributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
        
        // Use the actual servings from the order
        const servings = sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS;

        // Calculate total rewards based on servings
        const totalCoins = SHARED_ORDER_REWARD.coinsPerServing * servings;
        const totalRep = SHARED_ORDER_REWARD.repPerServing * servings;
        const totalSxp = SHARED_ORDER_REWARD.sxpPerServing * servings;

        // Calculate total quantity contributed
        const totalQuantity = contributions.reduce((sum, c) => sum + c.quantity, 0);

        // Build map of contributor ID -> total quantity they contributed
        const contributorQuantities = {};
        for (const contrib of contributions) {
          if (!contributorQuantities[contrib.user_id]) {
            contributorQuantities[contrib.user_id] = 0;
          }
          contributorQuantities[contrib.user_id] += contrib.quantity;
        }

        // Lock and update all contributors with scaled rewards
        const contributorLocks = [];
        const contributorRewards = {}; // For reward message
        for (const [contributorId, quantity] of Object.entries(contributorQuantities)) {
          // Scale rewards proportionally to contribution amount
          const scaleFactor = totalQuantity > 0 ? quantity / totalQuantity : 0;
          const coinsReward = Math.floor(totalCoins * scaleFactor);
          const repReward = Math.floor(totalRep * scaleFactor);
          const sxpReward = Math.floor(totalSxp * scaleFactor);

          contributorRewards[contributorId] = { coinsReward, repReward, sxpReward };

          contributorLocks.push(
            withLock(db, `lock:user:${contributorId}`, ownerLock, 8000, async () => {
              let player = ensurePlayer(serverId, contributorId);
              player.coins = (player.coins || 0) + coinsReward;
              player.rep = (player.rep || 0) + repReward;
              player.sxp_progress = (player.sxp_progress || 0) + sxpReward;

              // Apply SXP level up (modifies player in place)
              applySxpLevelUp(player);

              if (db) {
                upsertPlayer(db, serverId, contributorId, player, null, player.schema_version);
              }
            })
          );
        }

        // Wait for all contributor updates
        await Promise.all(contributorLocks);

        // Mark order complete (after all rewards distributed)
        completeSharedOrder(db, sharedOrder.shared_order_id);

        // Build reward message with individual scaled amounts
        const rewardLines = Object.entries(contributorRewards).map(([cId, rewards]) => {
          const contributionQty = contributorQuantities[cId];
          return `<@${cId}>: 💰 ${rewards.coinsReward}c | ⭐ ${rewards.repReward} REP | ✨ ${rewards.sxpReward} SXP (contributed ${contributionQty} ingredient${contributionQty !== 1 ? 's' : ''})`;
        });
        const rewardText = rewardLines.length > 0
          ? rewardLines.join("\n")
          : "No contributions recorded.";

        const embed = new EmbedBuilder()
          .setTitle("🎉 Shared Order Complete!")
          .setDescription(
            `**${recipe.name}** (${servings} servings)\n\n` +
            `👥 **Contributors**: ${Object.keys(contributorQuantities).length}\n` +
            `📊 **Rewards**:\n${rewardText}`
          )
          .setColor(0x00ff00);

        applyOwnerFooter(embed, interaction.member ?? interaction.user);

        const isLeader = party.leader_user_id === userId;
        const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
        return componentCommit(interaction, {
          embeds: [embed],
          components: [partyActionRow(userId, true, isLeader, !!existingOrder), socialMainMenuRow(userId)]
        });
      } catch (err) {
        return componentCommit(interaction, {
          content: `❌ ${err.message}`,
          ephemeral: true
        });
      }
    }

    if (action === "shared_order_cancel_complete") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      const isLeader = party.leader_user_id === userId;
      const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
      const recipe = existingOrder ? content.recipes?.[existingOrder.order_id] : null;
      const cancelEmbed = new EmbedBuilder()
        .setTitle("❌ Cancelled")
        .setDescription(
          `${recipe?.name ? `**${recipe.name}** (${existingOrder.servings ?? SHARED_ORDER_MIN_SERVINGS} servings)\n\n` : ""}` +
          "Shared order completion cancelled."
        )
        .setColor(0xffaa00);

      applyOwnerFooter(cancelEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [cancelEmbed],
        components: [partyActionRow(userId, true, isLeader, !!existingOrder), socialMainMenuRow(userId)]
      });
    }

    if (action === "shared_order_confirm_cancel") {
      if (!db) {
        return componentCommit(interaction, { content: "Database unavailable in this environment.", ephemeral: true });
      }
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      if (party.leader_user_id !== userId) {
        return componentCommit(interaction, {
          content: "❌ Only the party leader can cancel shared orders.",
          ephemeral: true
        });
      }

      const sharedOrder = getActiveSharedOrderByParty(db, party.party_id);
      if (!sharedOrder) {
        return componentCommit(interaction, {
          content: "❌ No active shared order to cancel.",
          ephemeral: true
        });
      }

      const ownerLock = `discord:${interaction.id}`;
      const contributions = getSharedOrderContributions(db, sharedOrder.shared_order_id);
      const refundsByUser = {};
      for (const contrib of contributions) {
        if (!contrib?.user_id || !contrib?.ingredient_id || !contrib?.quantity) continue;
        if (!refundsByUser[contrib.user_id]) refundsByUser[contrib.user_id] = {};
        refundsByUser[contrib.user_id][contrib.ingredient_id] =
          (refundsByUser[contrib.user_id][contrib.ingredient_id] ?? 0) + contrib.quantity;
      }

      const refundLocks = Object.entries(refundsByUser).map(([contributorId, items]) =>
        withLock(db, `lock:user:${contributorId}`, ownerLock, 8000, async () => {
          const player = ensurePlayer(serverId, contributorId);
          if (!player.inv_ingredients) player.inv_ingredients = {};
          for (const [ingredientId, qty] of Object.entries(items)) {
            player.inv_ingredients[ingredientId] = (player.inv_ingredients[ingredientId] ?? 0) + qty;
          }
          if (db) {
            upsertPlayer(db, serverId, contributorId, player, null, player.schema_version);
          }
        })
      );

      if (refundLocks.length) {
        await Promise.all(refundLocks);
      }

      cancelSharedOrder(db, sharedOrder.shared_order_id);

      const recipe = content.recipes?.[sharedOrder.order_id];
      const cancelEmbed = new EmbedBuilder()
        .setTitle("🧹 Shared Order Cancelled")
        .setDescription(
          `${recipe?.name ? `**${recipe.name}** (${sharedOrder.servings ?? SHARED_ORDER_MIN_SERVINGS} servings)\n\n` : ""}` +
          "Contributions have been returned to the party."
        )
        .setColor(0xffaa00);

      applyOwnerFooter(cancelEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [cancelEmbed],
        components: [sharedOrderActionRow(userId, false, true), socialMainMenuRow(userId)]
      });
    }

    if (action === "shared_order_abort_cancel") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in a party.",
          ephemeral: true
        });
      }

      const existingOrder = getActiveSharedOrderByParty(db, party.party_id);
      const isLeader = party.leader_user_id === userId;
      let canComplete = false;
      if (existingOrder) {
        const recipe = content.recipes[existingOrder.order_id];
        if (recipe) {
          const contributions = getSharedOrderContributions(db, existingOrder.shared_order_id);
          const progress = buildSharedOrderProgress({
            recipe,
            servings: existingOrder.servings ?? SHARED_ORDER_MIN_SERVINGS,
            contributions
          });
          canComplete = progress.isComplete;
        }
      }
      const keepEmbed = new EmbedBuilder()
        .setTitle("✅ Shared Order Kept")
        .setDescription("Keeping the shared order active.")
        .setColor(0x00aeff);

      applyOwnerFooter(keepEmbed, interaction.member ?? interaction.user);

      return componentCommit(interaction, {
        embeds: [keepEmbed],
        components: [sharedOrderActionRow(userId, !!existingOrder, isLeader, canComplete), socialMainMenuRow(userId)]
      });
    }

    if (action === "party_create") {
      const currentParty = getUserActiveParty(db, userId);
      if (currentParty) {
        return componentCommit(interaction, {
          content: `❌ You're already in party **${currentParty.party_name}**. Leave it first to create a new one.`,
          ephemeral: true
        });
      }

      if (interaction.deferred || interaction.replied) {
        return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
      }

      try {
        const sourceMessageId = interaction.message?.id ?? "none";
        return await interaction.showModal({
          customId: `noodle-social:modal:create_party:${userId}:${sourceMessageId}`,
          title: "Create Party",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  customId: "party_name",
                  label: "Party Name",
                  style: 1,
                  required: true,
                  maxLength: 32
                }
              ]
            }
          ]
        });
      } catch (e) {
        console.log(`⚠️ showModal failed for party_create:`, e?.message);
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal. Try using `/noodle-social party` command instead.", 
          ephemeral: true 
        });
      }
    }

    if (action === "party_join") {
      const currentParty = getUserActiveParty(db, userId);
      if (currentParty) {
        return componentCommit(interaction, {
          content: `❌ You're already in party **${currentParty.party_name}**. Leave it first to join another.`,
          ephemeral: true
        });
      }

      if (interaction.deferred || interaction.replied) {
        return componentCommit(interaction, { content: "That menu expired, tap again.", ephemeral: true });
      }

      try {
        const sourceMessageId = interaction.message?.id ?? "none";
        return await interaction.showModal({
          customId: `noodle-social:modal:join_party:${userId}:${sourceMessageId}`,
          title: "Join Party",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  customId: "party_id",
                  label: "Party ID",
                  style: 1,
                  required: true,
                  maxLength: 8
                }
              ]
            }
          ]
        });
      } catch (e) {
        console.log(`⚠️ showModal failed for party_join:`, e?.message);
        return componentCommit(interaction, { 
          content: "⚠️ Discord couldn't show the modal. Try using `/noodle-social party` command instead.", 
          ephemeral: true 
        });
      }
    }
  }

  return componentCommit(interaction, {
    content: "❌ Unknown action.",
    ephemeral: true
  });
}

/* ------------------------------------------------------------------ */
/*  Command definition                                                 */
/* ------------------------------------------------------------------ */

export const noodleSocialCommand = {
  data: new SlashCommandBuilder()
    .setName("noodle-social")
    .setDescription("Social features for Noodle Story")
    .addSubcommand(sc =>
      sc
        .setName("party")
        .setDescription("Manage your party")
        .addStringOption(o =>
          o
            .setName("action")
            .setDescription("Party action")
            .setRequired(true)
            .addChoices(
              { name: "Create", value: "create" },
              { name: "Join", value: "join" },
              { name: "Leave", value: "leave" },
              { name: "Info", value: "info" },
              { name: "Rename", value: "rename" },
              { name: "Transfer Leader", value: "transfer_leader" },
              { name: "Kick Member", value: "kick" }
            )
        )
        .addStringOption(o => o.setName("name").setDescription("Party name (for create/rename)").setRequired(false))
        .addStringOption(o => o.setName("party_id").setDescription("Party ID (for join)").setRequired(false))
        .addUserOption(o => o.setName("user").setDescription("Party member (for transfer/kick)").setRequired(false))
    )
    .addSubcommand(sc =>
      sc
        .setName("tip")
        .setDescription("Tip coins to another player")
        .addUserOption(o => o.setName("user").setDescription("Player to tip").setRequired(true))
        .addIntegerOption(o =>
          o
            .setName("amount")
            .setDescription("Amount of coins to tip")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
        .addStringOption(o => o.setName("message").setDescription("Optional message").setRequired(false))
    )
    .addSubcommand(sc =>
      sc
        .setName("visit")
        .setDescription("Visit another player's shop (grants blessing)")
        .addUserOption(o => o.setName("user").setDescription("Player to visit").setRequired(true))
    )
    .addSubcommand(sc =>
      sc
        .setName("leaderboard")
        .setDescription("View server leaderboards")
        .addStringOption(o =>
          o
            .setName("type")
            .setDescription("Leaderboard type")
            .setRequired(false)
            .addChoices(
              { name: "Coins", value: "coins" },
              { name: "Reputation", value: "rep" },
              { name: "Bowls Served", value: "bowls" }
            )
        )
    )
    .addSubcommand(sc => sc.setName("stats").setDescription("View your social stats")),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      switch (sub) {
        case "party":
          return await handleParty(interaction);
        case "tip":
          return await handleTip(interaction);
        case "visit":
          return await handleVisit(interaction);
        case "leaderboard":
          return await handleLeaderboard(interaction);
        case "stats":
          return await handleStats(interaction);
        default:
          return interaction.reply({ content: "❌ Unknown subcommand.", ephemeral: true });
      }
    } catch (err) {
      console.error(`Error in noodle-social ${sub}:`, err);
      const errorMsg = cozyError(err);
      
      return errorReply(interaction, `❌ ${errorMsg}`);
    }
  },

  async handleComponent(interaction) {
    return handleComponent(interaction);
  }
};

export { socialMainMenuRow, socialMainMenuRowNoProfile };
