import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { COUNTING_RESET_NOTICE } from "../src/game/counting.js";

test("approved counting reset copy exactly matches the runtime notice", () => {
  const reviewPacket = fs.readFileSync(new URL("../docs/PLAYER_COPY_REVIEW.md", import.meta.url), "utf8");
  assert.ok(reviewPacket.includes(COUNTING_RESET_NOTICE));
});
