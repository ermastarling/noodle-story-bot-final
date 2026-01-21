import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadTutorial() {
  const p = path.join(__dirname, "..", "..", "content", "tutorial.steps.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function ensureTutorial(player) {
  // If player has no tutorial state (older saves), initialize it.
  if (!player.tutorial) {
    const t = loadTutorial();
    player.tutorial = {
      active: true,
      queue: t.steps.map(s => s.id),
      completed: []
    };
  }
  if (player.tutorial.active === undefined) player.tutorial.active = true;
  if (!Array.isArray(player.tutorial.queue)) player.tutorial.queue = [];
  if (!Array.isArray(player.tutorial.completed)) player.tutorial.completed = [];
}

export function getCurrentTutorialStep(player) {
  ensureTutorial(player);
  if (!player.tutorial.active) return null;

  const t = loadTutorial();
  const nextId = player.tutorial.queue[0];
  if (!nextId) return null;

  return t.steps.find(s => s.id === nextId) ?? null;
}

export function advanceTutorial(player, eventName) {
  ensureTutorial(player);
  if (!player.tutorial.active) {
    return { progressed: false, finished: false };
  }

  const t = loadTutorial();
  const nextId = player.tutorial.queue[0];
  const step = t.steps.find(s => s.id === nextId);
  if (!step) return { progressed: false, finished: false };

  if (step.complete_on !== eventName) {
    return { progressed: false, finished: false };
  }

  player.tutorial.queue.shift();
  player.tutorial.completed.push(step.id);

  const finished = player.tutorial.queue.length === 0;
  if (finished) player.tutorial.active = false;

  return { progressed: true, finished };
}

export function formatTutorialMessage(step) {
  if (!step) return null;

  const stepText = step.text ?? "";
  const tipText = step.tip ?? "";

  const lines = [
    `🧾 **Tutorial — ${step.title}**`,
    stepText
  ];

  // ✅ blank line spacer between step text and step tip
  if (tipText) {
    lines.push("", `💡 ${tipText}`);
  }

  return lines.join("\n");
}

export function formatTutorialCompletionMessage() {
  return [
    "✨ **Your noodle shop is officially open!**",
    "From here, you can play freely:",
    "",
    "• Start each day with `/noodle orders` to accept, cook and serve customers using the provided buttons.",
    "• Track your growth with `/noodle profile` and use `/noodle help` for command help.",
    "",
    "Your story begins here, etch your noodle shop into legend, one bowl at a time 🍜"
  ].join("\n");
}