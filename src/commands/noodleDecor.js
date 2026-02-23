import discordPkg from "discord.js";
import {
  DECOR_SLOTS,
  buildDecorOwnershipSummary,
  formatDecorSlotLabel,
  getDecorItemById,
  getDecorItemsBySlot,
  getOwnedDecorItems
} from "../game/decor.js";
import { theme } from "../ui/theme.js";
import { getIcon, getButtonEmoji } from "../ui/icons.js";

const { MessageEmbed } = discordPkg;
const EmbedBuilder = MessageEmbed;

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

export function renderDecorOwnedEmbed({ player, decorContent, serverState, ownerUser }) {
  const description = buildDecorOwnershipSummary(player, decorContent, serverState);
  return buildMenuEmbed({
    title: `${getIcon("decor")} Décor — Owned`,
    description,
    user: ownerUser
  });
}

export function renderDecorSlotsEmbed({ player, decorContent, ownerUser }) {
  const slots = player.profile?.decor_slots ?? {};
  const lines = DECOR_SLOTS.map((slot) => {
    const itemId = slots[slot];
    const item = getDecorItemById(decorContent, itemId);
    const name = item?.name ?? (itemId ? itemId : "None");
    return `• **${formatDecorSlotLabel(slot)}**: ${name}`;
  });

  return buildMenuEmbed({
    title: `${getIcon("decor")} Décor — Equipped`,
    description: lines.join("\n"),
    user: ownerUser
  });
}

export function renderDecorSetsEmbed({ player, decorSetsContent, ownerUser }) {
  const completed = new Set(player.profile?.decor_sets_completed ?? []);
  const lines = (decorSetsContent?.sets ?? []).map((set) => {
    const status = completed.has(set.set_id) ? getIcon("status_complete") : getIcon("status_incomplete");
    const pieces = (set.pieces ?? []).map((p) => p.item_id).join(", ");
    return `${status} **${set.name}**\n${pieces}`;
  });

  return buildMenuEmbed({
    title: `${getIcon("decor")} Décor — Sets`,
    description: lines.length ? lines.join("\n\n") : "_No sets defined yet._",
    user: ownerUser
  });
}

export function renderDecorShopEmbed({ player, decorContent, ownerUser }) {
  const owned = new Set(getOwnedDecorItems(player));
  const lines = [];

  for (const slot of DECOR_SLOTS) {
    const items = getDecorItemsBySlot(decorContent, slot);
    const list = items
      .filter((item) => !owned.has(item.item_id))
      .map((item) => `• ${item.name} (${item.rarity})`);
    if (list.length) {
      lines.push(`**${formatDecorSlotLabel(slot)}**\n${list.join("\n")}`);
    }
  }

  return buildMenuEmbed({
    title: `${getIcon("decor")} Décor — Shop`,
    description: lines.length ? lines.join("\n\n") : "_No new décor available._",
    user: ownerUser
  });
}
