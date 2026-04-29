import { resolveNavSubForTutorial } from "../game/tutorialRouting.js";

export function resolveComponentNavSub({ player, sub }) {
  return resolveNavSubForTutorial({ player, action: sub, fallbackSub: sub });
}