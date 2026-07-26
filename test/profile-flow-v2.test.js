import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSpecializationListV2Message,
  buildProfileEditV2Message,
  buildProfileHomeV2Message,
  buildSpecializationConfirmV2Message,
  buildSpecializationUpdatedV2Message
} from "../src/ui/profileFlowV2.js";

test("Profile flow V2: button emojis are normalized to emoji objects", () => {
  const payload = buildProfileHomeV2Message({
    userId: "123",
    viewingSelf: true,
    buttonEmoji: {
      orders: "<:orders:147000000000000000>",
      cart: "🛒"
    },
    embed: {
      title: "Profile",
      description: "desc",
      fields: []
    }
  });

  const container = payload.components?.[0]?.components ?? [];
  const rows = container.filter((node) => node?.type === 1);
  const buttons = rows.flatMap((row) => row.components ?? []);

  const ordersButton = buttons.find((button) => button?.custom_id === "noodle:nav:orders:123");
  assert.ok(ordersButton);
  assert.deepEqual(ordersButton.emoji, {
    name: "orders",
    id: "147000000000000000",
    animated: false
  });

  const buyButton = buttons.find((button) => button?.custom_id === "noodle:nav:buy:123");
  assert.ok(buyButton);
  assert.deepEqual(buyButton.emoji, { name: "🛒" });

  const statBlock = container.find((node) => node?.type === 10 && String(node?.content || "").includes("Bowls Served"));
  assert.ok(statBlock);
  assert.match(String(statBlock.content), /```/);
  assert.match(String(statBlock.content), /Bowls Served\s+\|\s+Level/);
  assert.match(String(statBlock.content), /REP\s+\|\s+Coins/);
  assert.equal(String(statBlock.content).includes("| Stat | Value |"), false);
});

test("Profile flow V2: customize menu keeps canonical wording", () => {
  const payload = buildProfileEditV2Message({
    userId: "123"
  });

  const container = payload.components?.[0]?.components ?? [];
  const copyBlock = container.find((node) => node?.type === 10 && String(node?.content || "").includes("Change your shop name"));
  assert.ok(copyBlock);
  const text = String(copyBlock.content || "");
  assert.match(text, /Change your shop name and tagline\./);
  assert.match(text, /Change your shop specialization\./);
  assert.match(text, /Check out the Store for premium specializations, coin packs, and subscription perks\./);
});

test("Profile flow V2: specialization confirm includes thumbnail accessory", () => {
  const payload = buildSpecializationConfirmV2Message({
    userId: "123",
    specId: "festival_noodle_house",
    specName: "Festival Noodle House",
    specDescription: "A lively festival nook.",
    specThumbnailUrl: "https://example.com/spec.png"
  });

  const container = payload.components?.[0]?.components ?? [];
  const accessory = container.find((node) => Number(node?.type) === 9);
  assert.ok(accessory);
  const accessoryUrl = accessory?.accessory?.media?.url ?? "";
  assert.equal(String(accessoryUrl), "https://example.com/spec.png");
});

test("Profile flow V2: specialization list includes thumbnail accessory", () => {
  const payload = buildSpecializationListV2Message({
    userId: "123",
    entries: [{
      name: "Festival Noodle House",
      statusLine: "Available",
      description: "A lively festival nook.",
      thumbnailUrl: "https://example.com/list.png"
    }]
  });

  const container = payload.components?.[0]?.components ?? [];
  const accessory = container.find((node) => Number(node?.type) === 9);
  assert.ok(accessory);
  const accessoryUrl = accessory?.accessory?.media?.url ?? "";
  assert.equal(String(accessoryUrl), "https://example.com/list.png");
});

test("Profile flow V2: specialization updated view keeps thumbnail gallery", () => {
  const payload = buildSpecializationUpdatedV2Message({
    userId: "123",
    specName: "Festival Noodle House",
    specThumbnailUrl: "https://example.com/spec.png"
  });

  const container = payload.components?.[0]?.components ?? [];
  const gallery = container.find((node) => Number(node?.type) === 12);
  assert.ok(gallery);
  const galleryUrl = gallery?.items?.[0]?.media?.url ?? "";
  assert.equal(String(galleryUrl), "https://example.com/spec.png");
});