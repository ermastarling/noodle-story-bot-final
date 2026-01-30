import { SlashCommandBuilder } from "@discordjs/builders";
import discordPkg from "discord.js";
import { openDb, getPlayer, upsertPlayer, getServer, upsertServer } from "../db/index.js";
import { withLock } from "../infra/locks.js";
import { makeIdempotencyKey, getIdempotentResult, putIdempotentResult } from "../infra/idempotency.js";
import { newPlayerProfile } from "../game/player.js";
import { newServerState } from "../game/server.js";
import { noodleMainMenuRowNoProfile } from "./noodle.js";
import {
  grantBlessing,
  getActiveBlessing,
  createParty,
  joinParty,
  inviteUserToParty,
  leaveParty,
  getParty,
  getUserActiveParty,
  transferTip,
  getUserTipStats,
  logVisitActivity,
  getVisitPatternSummary,
  BLESSING_DURATION_HOURS,
  BLESSING_COOLDOWN_HOURS
} from "../game/social.js";
import { nowTs } from "../util/time.js";

const {
  MessageActionRow,
  MessageButton,
  MessageEmbed,
  Modal,
  TextInputComponent,
  Constants
} = discordPkg;

// Aliases for v14+ compatibility
const ActionRowBuilder = MessageActionRow;
const ButtonBuilder = MessageButton;
const EmbedBuilder = MessageEmbed;

const ButtonStyle = {
  Primary: Constants?.MessageButtonStyles?.PRIMARY ?? 1,
  Secondary: Constants?.MessageButtonStyles?.SECONDARY ?? 2,
  Success: Constants?.MessageButtonStyles?.SUCCESS ?? 3,
  Danger: Constants?.MessageButtonStyles?.DANGER ?? 4,
  Link: Constants?.MessageButtonStyles?.LINK ?? 5
};

const db = openDb();

/* ------------------------------------------------------------------ */
/*  UI Button Helpers                                                  */
/* ------------------------------------------------------------------ */

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
      .setCustomId(`noodle-social:nav:leaderboard:${userId}`)
      .setLabel("📊 Leaderboard")
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
      .setCustomId(`noodle-social:nav:leaderboard:${userId}`)
      .setLabel("📊 Leaderboard")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle-social:nav:stats:${userId}`)
      .setLabel("📈 Stats")
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Party action buttons (conditional based on party state)
 */
function partyActionRow(userId, inParty, isPartyLeader) {
  const components = [];
  
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

/**
 * Party creation buttons (only shown if not in a party)
 */
function partyCreationRow(userId) {
  return new ActionRowBuilder().addComponents(
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
      .setCustomId(`noodle-social:nav:stats:${userId}`)
      .setLabel("📈 Stats")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`noodle:action:orders:${userId}`)
      .setLabel("📋 Orders")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:action:buy:${userId}`)
      .setLabel("🛒 Buy")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`noodle:action:forage:${userId}`)
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
  if (interaction.deferred) {
    return interaction.editReply(opts);
  } else if (interaction.replied) {
    return interaction.followUp(opts);
  } else {
    return interaction.update(opts);
  }
}

/**
 * Format a party ID for display (first 8 characters)
 */
function formatPartyId(partyId) {
  return partyId.substring(0, 8);
}

function ensureServer(serverId) {
  let s = getServer(db, serverId);
  if (!s) {
    s = newServerState(serverId);
    upsertServer(db, serverId, s, null);
    s = getServer(db, serverId);
  }
  return s;
}

function ensurePlayer(serverId, userId) {
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

  await interaction.deferReply({ ephemeral: false });

  const ownerLock = `discord:${interaction.id}`;

  return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
    const player = ensurePlayer(serverId, userId);

    if (action === "create") {
      if (!partyName) {
        return interaction.editReply({ content: "❌ Please provide a party name." });
      }

      // Check if already in a party
      const currentParty = getUserActiveParty(db, userId);
      if (currentParty) {
        return interaction.editReply({
          content: `❌ You're already in party **${currentParty.party_name}**. Leave it first to create a new one.`
        });
      }

      const result = createParty(db, serverId, userId, partyName);

      const embed = new EmbedBuilder()
        .setTitle("🎉 Party Created!")
        .setDescription(`You've created the party **${result.partyName}**`)
        .addFields(
          { name: "Party ID", value: formatPartyId(result.partyId), inline: true },
          { name: "Leader", value: `<@${userId}>`, inline: true }
        )
        .setColor(0x00ff00);

      return interaction.editReply({ 
        embeds: [embed], 
        components: [partyActionRow(userId, true, true), socialMainMenuRow(userId)] 
      });
    }

    if (action === "join") {
      if (!partyId) {
        return interaction.editReply({ content: "❌ Please provide a party ID to join." });
      }

      try {
        const result = joinParty(db, partyId, userId);
        
        const embed = new EmbedBuilder()
          .setTitle("🎊 Joined Party!")
          .setDescription(`You've joined the party **${result.partyName}**`)
          .setColor(0x00ff00);

        return interaction.editReply({ 
          embeds: [embed], 
          components: [partyActionRow(userId, true, false), socialMainMenuRow(userId)] 
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }
    }

    if (action === "leave") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return interaction.editReply({ content: "❌ You're not in any party." });
      }

      try {
        leaveParty(db, currentParty.party_id, userId);
        
        return interaction.editReply({
          content: `✅ You've left the party **${currentParty.party_name}**.`,
          components: [socialMainMenuRow(userId)]
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }
    }

    if (action === "info") {
      const currentParty = getUserActiveParty(db, userId);
      if (!currentParty) {
        return interaction.editReply({ content: "❌ You're not in any party." });
      }

      const memberList = currentParty.members
        .map((m, i) => `${i + 1}. <@${m.user_id}> (${m.contribution_points} points)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎪 ${currentParty.party_name}`)
        .setDescription(`Party ID: ${formatPartyId(currentParty.party_id)}`)
        .addFields(
          { name: "Leader", value: `<@${currentParty.leader_user_id}>`, inline: true },
          { name: "Members", value: `${currentParty.members.length}/${currentParty.max_members}`, inline: true },
          { name: "Member List", value: memberList || "No members", inline: false }
        )
        .setColor(0x00aeff);

      const isLeader = currentParty.leader_user_id === userId;
      return interaction.editReply({ 
        embeds: [embed], 
        components: [partyActionRow(userId, true, isLeader), socialMainMenuRow(userId)] 
      });
    }

    return interaction.editReply({ content: "❌ Unknown party action." });
  });
}

async function handleTip(interaction) {
  const serverId = interaction.guildId;
  const userId = interaction.user.id;
  const targetUser = interaction.options.getUser("user");
  const amount = interaction.options.getInteger("amount");
  const message = interaction.options.getString("message");

  if (!targetUser) {
    return interaction.reply({ content: "❌ Please specify a user to tip.", ephemeral: false });
  }

  if (targetUser.id === userId) {
    return interaction.reply({ content: "❌ You cannot tip yourself!", ephemeral: false });
  }

  await interaction.deferReply({ ephemeral: false });

  const action = "tip";
  const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
  const cached = getIdempotentResult(db, idemKey);
  if (cached) return interaction.editReply(cached);

  const ownerLock = `discord:${interaction.id}`;

  return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
    return await withLock(db, `lock:user:${targetUser.id}`, ownerLock, 8000, async () => {
      let sender = ensurePlayer(serverId, userId);
      let receiver = ensurePlayer(serverId, targetUser.id);

      try {
        const result = transferTip(db, serverId, sender, receiver, amount, message);

        // Save both players
        upsertPlayer(db, serverId, userId, result.sender, null, result.sender.schema_version);
        upsertPlayer(db, serverId, targetUser.id, result.receiver, null, result.receiver.schema_version);

        const embed = new EmbedBuilder()
          .setTitle("💰 Tip Sent!")
          .setDescription(`<@${userId}> tipped <@${targetUser.id}> **${amount} coins**!`)
          .setColor(0xffd700);

        if (message) {
          embed.addFields({ name: "Message", value: message, inline: false });
        }

        embed.addFields(
          { name: "Your Balance", value: `${result.sender.coins}c`, inline: true },
          { name: "Their Balance", value: `${result.receiver.coins}c`, inline: true }
        );

        const replyObj = { 
          embeds: [embed], 
          components: [socialMainMenuRow(userId)] 
        };
        putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
        return interaction.editReply(replyObj);
      } catch (err) {
        return interaction.editReply({ content: `❌ ${err.message}` });
      }
    });
  });
}

async function handleVisit(interaction) {
  const serverId = interaction.guildId;
  const userId = interaction.user.id;
  const targetUser = interaction.options.getUser("user");

  if (!targetUser) {
    return interaction.reply({ content: "❌ Please specify a user to visit.", ephemeral: false });
  }

  if (targetUser.id === userId) {
    return interaction.reply({ content: "❌ You cannot visit yourself!", ephemeral: false });
  }

  await interaction.deferReply({ ephemeral: false });

  const action = "visit";
  const idemKey = makeIdempotencyKey({ serverId, userId, action, interactionId: interaction.id });
  const cached = getIdempotentResult(db, idemKey);
  if (cached) return interaction.editReply(cached);

  const ownerLock = `discord:${interaction.id}`;

  return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
    let serverState = ensureServer(serverId);
    let visitor = ensurePlayer(serverId, userId);

    try {
      // Grant a random blessing (for simplicity, using "discovery_chance_add")
      const blessingType = "discovery_chance_add";
      visitor = grantBlessing(visitor, targetUser.id, blessingType);

      // Log visit for analytics (D6)
      serverState = logVisitActivity(serverState, userId, targetUser.id);

      // Save state
      upsertPlayer(db, serverId, userId, visitor, null, visitor.schema_version);
      upsertServer(db, serverId, serverState, null);

      const blessing = getActiveBlessing(visitor);
      const expiresInHours = blessing ? Math.round((blessing.expires_at - nowTs()) / (60 * 60 * 1000)) : BLESSING_DURATION_HOURS;

      const embed = new EmbedBuilder()
        .setTitle("🌟 Shop Visit!")
        .setDescription(
          `<@${userId}> visited <@${targetUser.id}>'s shop and received a **Blessing**!\n\n` +
          `✨ **Effect**: Enhanced discovery chance\n` +
          `⏰ **Duration**: ${expiresInHours} hours\n` +
          `🔄 **Cooldown**: ${BLESSING_COOLDOWN_HOURS} hours after expiry`
        )
        .setColor(0xffaa00);

      const replyObj = { 
        embeds: [embed], 
        components: [socialMainMenuRow(userId)] 
      };
      putIdempotentResult(db, { key: idemKey, userId, action, ttlSeconds: 900, result: replyObj });
      return interaction.editReply(replyObj);
    } catch (err) {
      return interaction.editReply({ content: `❌ ${err.message}` });
    }
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
      return interaction.editReply({ content: "❌ No players found in this server yet." });
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
      return interaction.editReply({ content: "❌ Unknown leaderboard type." });
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
      .setFooter({ text: "Rankings are read-only and for fun!" });

    return interaction.editReply({ 
      embeds: [embed], 
      components: [socialMainMenuRow(interaction.user.id)] 
    });
  } catch (err) {
    console.error("Leaderboard error:", err);
    return interaction.editReply({ content: `❌ Error loading leaderboard: ${err.message}` });
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
      embed.addFields({
        name: "✨ Active Blessing",
        value: `Type: ${blessing.type}\nExpires in: ${remainingHours} hours`,
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
    return interaction.editReply({ content: `❌ Error loading stats: ${err.message}` });
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
    if (customId.startsWith("noodle-social:modal:create_party:")) {
      const partyName = interaction.fields.getTextInputValue("party_name");
      
      if (!partyName || partyName.trim().length === 0) {
        return interaction.reply({ content: "❌ Party name cannot be empty.", ephemeral: true });
      }

      const ownerLock = `discord:${interaction.id}`;

      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        try {
          const result = createParty(db, serverId, userId, partyName);

          const embed = new EmbedBuilder()
            .setTitle("🎉 Party Created!")
            .setDescription(`You've created the party **${result.partyName}**`)
            .addFields(
              { name: "Party ID", value: formatPartyId(result.partyId), inline: true },
              { name: "Leader", value: `<@${userId}>`, inline: true }
            )
            .setColor(0x00ff00);

          return interaction.editReply({ 
            embeds: [embed], 
            components: [partyActionRow(userId, true, true), socialMainMenuRow(userId)] 
          });
        } catch (err) {
          return interaction.editReply({ content: `❌ ${err.message}` });
        }
      });
    }

    if (customId.startsWith("noodle-social:modal:join_party:")) {
      const partyId = interaction.fields.getTextInputValue("party_id");

      if (!partyId || partyId.trim().length === 0) {
        return interaction.reply({ content: "❌ Party ID cannot be empty.", ephemeral: true });
      }

      const ownerLock = `discord:${interaction.id}`;

      return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
        try {
          const result = joinParty(db, serverId, partyId, userId);
          
          const embed = new EmbedBuilder()
            .setTitle("🎊 Joined Party!")
            .setDescription(`You've joined the party **${result.partyName}**`)
            .setColor(0x00ff00);

          return interaction.editReply({ 
            embeds: [embed], 
            components: [partyActionRow(userId, true, false), socialMainMenuRow(userId)] 
          });
        } catch (err) {
          return interaction.editReply({ content: `❌ ${err.message}` });
        }
      });
    }

    if (customId.startsWith("noodle-social:modal:invite_user:")) {
      const nameInput = interaction.fields.getTextInputValue("name");

      if (!nameInput || nameInput.trim().length === 0) {
        return interaction.reply({ content: "❌ Name cannot be empty.", ephemeral: true });
      }

      const searchName = nameInput.trim().toLowerCase();
      const ownerLock = `discord:${interaction.id}`;

      try {
        return await withLock(db, `lock:user:${userId}`, ownerLock, 8000, async () => {
          try {
            // Only allow inviting users in this server
            const guild = interaction.guild;
            if (!guild) {
              return interaction.editReply({ content: "❌ This command only works in a server." });
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
              return interaction.editReply({ content: `❌ User **${searchName}** not found. Make sure they're in this server and try their exact username or nickname.` });
            }
            const inviteTargetId = targetMember.user.id;
            const currentParty = getUserActiveParty(db, userId);
            if (!currentParty) {
              return interaction.editReply({ content: "❌ You're not in a party anymore." });
            }

            console.log(`🎪 Inviting to party: ${currentParty.party_name}`);
            const result = inviteUserToParty(db, serverId, currentParty.party_id, inviteTargetId);
            console.log(`✅ Invite successful, sending response`);
            
            const embed = new EmbedBuilder()
              .setTitle("✅ User Invited!")
              .setDescription(`**${targetMember.displayName}** has been invited to **${result.partyName}**`)
              .setColor(0x00ff00);

            return interaction.editReply({ 
              embeds: [embed], 
              components: [partyActionRow(userId, true, true), socialMainMenuRow(userId)] 
            });
          } catch (err) {
            console.error(`❌ Error in invite handler:`, err);
            return interaction.editReply({ content: `❌ ${err.message}` });
          }
        });
      } catch (err) {
        console.error(`❌ withLock failed:`, err);
        try {
          return interaction.editReply({ content: `❌ ${err.message}` });
        } catch (e) {
          console.log(`⚠️ editReply also failed:`, e?.message);
        }
      }
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

  /* ---------------- NAV BUTTONS ---------------- */
  if (kind === "nav") {
    // Navigate to different social views
    if (action === "party") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "You're not in any party. Create or join one!",
          components: [partyCreationRow(userId), socialMainMenuRow(userId)],
          ephemeral: false
        });
      }

      const memberList = party.members
        .map((m, i) => `${i + 1}. <@${m.user_id}> (${m.contribution_points} points)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎪 ${party.party_name}`)
        .setDescription(`Party ID: ${formatPartyId(party.party_id)}`)
        .addFields(
          { name: "Leader", value: `<@${party.leader_user_id}>`, inline: true },
          { name: "Members", value: `${party.members.length}/${party.max_members}`, inline: true },
          { name: "Member List", value: memberList || "No members", inline: false }
        )
        .setColor(0x00aeff);

      const isLeader = party.leader_user_id === userId;
      return componentCommit(interaction, {
        embeds: [embed],
        components: [partyActionRow(userId, true, isLeader), socialMainMenuRow(userId)]
      });
    }

    if (action === "leaderboard") {
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
        .setFooter({ text: "Rankings are read-only and for fun!" });

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
        embed.addFields({
          name: "✨ Active Blessing",
          value: `Type: ${blessing.type}\nExpires in: ${remainingHours} hours`,
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
      
      if (!player.profile) {
        player.profile = {
          shop_name: "My Noodle Shop",
          tagline: "A tiny shop with a big simmer."
        };
      }
      
      let description = `*${player.profile.tagline}*`;
      if (party) {
        description += `\n\n🎪 **${party.party_name}**`;
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`🍜 ${player.profile.shop_name}`)
        .setDescription(description)
        .addFields(
          { name: "⭐ Bowls Served", value: String(player.lifetime?.bowls_served_total || 0), inline: true },
          { name: "Level", value: String(player.shop_level || 1), inline: true },
          { name: "REP", value: String(player.rep || 0), inline: true },
          { name: "Coins", value: `${player.coins || 0}c`, inline: true }
        )
        .setColor(0x00ff88)
        .setFooter({ text: `Owner: ${interaction.user.displayName}` });

      return componentCommit(interaction, {
        embeds: [embed],
        components: [noodleMainMenuRowNoProfile(userId), socialMainMenuRowNoProfile(userId)]
      });
    }
  }

  /* ---------------- ACTION BUTTONS ---------------- */
  if (kind === "action") {
    if (action === "party_info") {
      const party = getUserActiveParty(db, userId);
      if (!party) {
        return componentCommit(interaction, {
          content: "❌ You're not in any party.",
          ephemeral: false
        });
      }

      const memberList = party.members
        .map((m, i) => `${i + 1}. <@${m.user_id}> (${m.contribution_points} points)`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`🎪 ${party.party_name}`)
        .setDescription(`Party ID: ${formatPartyId(party.party_id)}`)
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
        return await interaction.showModal({
          customId: `noodle-social:modal:create_party:${userId}`,
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
        return await interaction.showModal({
          customId: `noodle-social:modal:join_party:${userId}`,
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
              { name: "Info", value: "info" }
            )
        )
        .addStringOption(o => o.setName("name").setDescription("Party name (for create)").setRequired(false))
        .addStringOption(o => o.setName("party_id").setDescription("Party ID (for join)").setRequired(false))
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
          return interaction.reply({ content: "❌ Unknown subcommand.", ephemeral: false });
      }
    } catch (err) {
      console.error(`Error in noodle-social ${sub}:`, err);
      const errorMsg = cozyError(err);
      
      if (interaction.deferred) {
        return interaction.editReply({ content: `❌ ${errorMsg}` });
      } else {
        return interaction.reply({ content: `❌ ${errorMsg}`, ephemeral: false });
      }
    }
  },

  async handleComponent(interaction) {
    return handleComponent(interaction);
  }
};

export { socialMainMenuRow, socialMainMenuRowNoProfile };
