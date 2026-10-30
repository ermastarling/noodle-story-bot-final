import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getIcon } from "../src/ui/icons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readContent = (filename) => JSON.parse(fs.readFileSync(path.join(__dirname, "../content", filename), "utf8"));
const badges = readContent("badges.json");
const achievements = readContent("achievements.json");
const collections = readContent("collections.json");

test("Achievement and collection badge artwork artwork keys cover every catalog entry", () => {
  const achievementIds = achievements.achievements.map((entry) => entry.achievement_id).sort();
  const collectionIds = collections.collections.map((entry) => entry.collection_id).sort();
  const achievementArtworkIds = Object.keys(badges.achievement_artwork ?? {}).sort();
  const collectionArtworkIds = Object.keys(badges.collection_artwork ?? {}).sort();

  assert.deepEqual(achievementArtworkIds, achievementIds);
  assert.deepEqual(collectionArtworkIds, collectionIds);
  for (const id of [...achievementIds, ...collectionIds]) {
    const iconKey = badges.achievement_artwork[id] ?? badges.collection_artwork[id];
    assert.equal(iconKey, id);
  }
});

test("Uploaded artwork replaces every shared placeholder and new banners resolve", async () => {
  const icons = readContent("icons.json").icons;
  const placeholder = getIcon("badges");
  const ids = [
    ...badges.badges.map((entry) => entry.icon),
    ...Object.keys(badges.achievement_artwork),
    ...Object.keys(badges.collection_artwork)
  ];
  for (const id of ids) {
    assert.match(getIcon(id), /^<a?:[^:]+:\d+>$/, id);
    if (id !== "badges") assert.notEqual(getIcon(id), placeholder, id);
  }
  assert.ok(icons.scene_banners ?? Object.values(icons).some((group) => group.scene_banner_stats));

  const { buildComponentsV2MenuPayload } = await import("../src/ui/componentsV2.js");
  for (const [heading, file] of [["Daily Order Board Menu", "Menu.png"], ["Your Social Stats", "Stats.png"], ["Orders", "Orders.png"]]) {
    const payload = buildComponentsV2MenuPayload({
      components: [{ type: 10, content: `## ${heading}` }, { type: 10, content: "body" }],
      ownerId: "12345678901234567"
    });
    assert.ok(JSON.stringify(payload).includes(file), heading);
  }
});
