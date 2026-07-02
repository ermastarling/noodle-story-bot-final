import { MESSAGE_FLAG_IS_COMPONENTS_V2 } from "./componentsV2.js";

function text(content) {
  return { type: 10, content: String(content ?? "").trim() || "-" };
}

function button({ sceneKey, actionKey, userId, token, arg, label, style = 2, disabled = false } = {}) {
  const customId = arg
    ? `noodle:v2:${sceneKey}:${actionKey}:${userId}:${token}:${arg}`
    : `noodle:v2:${sceneKey}:${actionKey}:${userId}:${token}`;
  return {
    type: 2,
    style,
    label,
    custom_id: customId,
    disabled: Boolean(disabled)
  };
}

function clampQuantity(quantity) {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) return 1;
  const rounded = Math.floor(parsed);
  return Math.max(1, Math.min(99, rounded));
}

function clampScore(score, totalTurns) {
  const parsedScore = Math.floor(Number(score) || 0);
  const parsedTurns = Math.max(1, Math.floor(Number(totalTurns) || 1));
  return Math.max(0, Math.min(parsedTurns, parsedScore));
}

function toPct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function normalizeBias(bias) {
  const safe = String(bias || "").trim().toLowerCase();
  if (["excellent", "great", "good", "salvage"].includes(safe)) return safe;
  return "good";
}

export function createCookRunToken({ userId, recipeId, quantity, nowMs = Date.now() } = {}) {
  const parts = [String(userId || ""), String(recipeId || ""), String(quantity || ""), String(nowMs || "")];
  let hash = 2166136261;
  const raw = parts.join("|");
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = (hash >>> 0).toString(36);
  return `${Number(nowMs || Date.now()).toString(36)}${normalized}`;
}

export function buildCookMinigameTargetActions({ recipeId, runToken, totalTurns = 8 } = {}) {
  const actions = ["prep", "heat", "plate", "serve"];
  const safeTurns = Math.max(1, Math.floor(Number(totalTurns) || 8));
  const seedSource = `${String(recipeId || "")}::${String(runToken || "")}`;
  let seed = 0;
  for (let i = 0; i < seedSource.length; i += 1) {
    seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;
  }
  const sequence = [];
  for (let i = 0; i < safeTurns; i += 1) {
    const idx = (seed + (i * 7) + ((i % 3) * 13)) % actions.length;
    sequence.push(actions[idx]);
  }
  return sequence;
}

export function evaluateCookMinigameTurn({
  action,
  targetAction,
  turnStartedAt,
  nowMs = Date.now(),
  turnMs = 2200,
  graceMs = 650
} = {}) {
  const safeTurnMs = Math.max(250, Math.floor(Number(turnMs) || 2200));
  const safeGraceMs = Math.max(0, Math.floor(Number(graceMs) || 650));
  const startedAt = Math.floor(Number(turnStartedAt) || nowMs);
  const elapsedMs = Math.max(0, Math.floor(Number(nowMs) || Date.now()) - startedAt);
  const allowedMs = safeTurnMs + safeGraceMs;
  const withinWindow = elapsedMs <= allowedMs;
  const safeAction = String(action || "").trim().toLowerCase();
  const safeTarget = String(targetAction || "").trim().toLowerCase();
  const isCorrect = safeAction === safeTarget;
  const isHit = isCorrect && withinWindow;

  return {
    isHit,
    isCorrect,
    withinWindow,
    elapsedMs,
    turnMs: safeTurnMs,
    graceMs: safeGraceMs,
    allowedMs,
    lateByMs: withinWindow ? 0 : elapsedMs - allowedMs,
    scoreDelta: isHit ? 1 : 0,
    missDelta: isHit ? 0 : 1,
    status: isHit ? "hit" : (withinWindow ? "wrong_action" : "late")
  };
}

export function deriveCookMinigamePerformance({ score = 0, totalTurns = 1, quantity = 1 } = {}) {
  const safeTurns = Math.max(1, Math.floor(Number(totalTurns) || 1));
  const safeScore = clampScore(score, safeTurns);
  const safeQuantity = clampQuantity(quantity);
  const accuracy = Math.max(0, Math.min(1, safeScore / safeTurns));

  let bucket = "rough";
  let successRatio = 0.4;
  let qualityBias = "salvage";

  if (accuracy >= 0.9) {
    bucket = "perfect";
    successRatio = 1;
    qualityBias = "excellent";
  } else if (accuracy >= 0.75) {
    bucket = "great";
    successRatio = 0.85;
    qualityBias = "great";
  } else if (accuracy >= 0.5) {
    bucket = "okay";
    successRatio = 0.65;
    qualityBias = "good";
  }

  const successBowls = Math.max(0, Math.min(safeQuantity, Math.round(safeQuantity * successRatio)));
  const failBowls = Math.max(0, safeQuantity - successBowls);

  return {
    bucket,
    qualityBias,
    accuracy,
    accuracyLabel: toPct(accuracy),
    successBowls,
    failBowls,
    score: safeScore,
    totalTurns: safeTurns,
    quantity: safeQuantity
  };
}

export function buildQualityCountsForBias({ success = 0, bias = "good" } = {}) {
  const safeSuccess = Math.max(0, Math.floor(Number(success) || 0));
  if (safeSuccess <= 0) return {};
  const safeBias = normalizeBias(bias);
  if (safeBias === "excellent") {
    const excellent = Math.max(1, Math.ceil(safeSuccess * 0.7));
    return { excellent, great: Math.max(0, safeSuccess - excellent) };
  }
  if (safeBias === "great") {
    const great = Math.max(1, Math.ceil(safeSuccess * 0.65));
    return { great, good: Math.max(0, safeSuccess - great) };
  }
  if (safeBias === "salvage") {
    const good = Math.max(1, Math.ceil(safeSuccess * 0.45));
    return { good, common: Math.max(0, safeSuccess - good) };
  }
  const good = Math.max(1, Math.ceil(safeSuccess * 0.7));
  return { good, common: Math.max(0, safeSuccess - good) };
}

export function resolveCookOutcomeForFlow({
  v2MinigameCook = false,
  batchOutput = 0,
  minigameScore = 0,
  minigameTurns = 1,
  successBowlsOverride,
  qualityBias,
  rollBatchOutcomeFn,
  rollBatchOutcomeArgs
} = {}) {
  const safeBatchOutput = Math.max(0, Math.floor(Number(batchOutput) || 0));
  if (!v2MinigameCook) {
    return rollBatchOutcomeFn(rollBatchOutcomeArgs);
  }

  const perf = deriveCookMinigamePerformance({
    score: minigameScore,
    totalTurns: minigameTurns,
    quantity: safeBatchOutput
  });
  const resolvedSuccess = Number.isFinite(successBowlsOverride)
    ? Math.max(0, Math.min(safeBatchOutput, Math.floor(Number(successBowlsOverride))))
    : perf.successBowls;
  const success = Math.max(0, Math.min(safeBatchOutput, resolvedSuccess));
  const failed = Math.max(0, safeBatchOutput - success);
  const bias = normalizeBias(qualityBias || perf.qualityBias);
  const qualityCounts = buildQualityCountsForBias({ success, bias });

  return {
    success,
    failed,
    salvage: 0,
    qualityCounts,
    qualityBias: bias,
    performance: perf
  };
}

export function buildCookRecipePickerV2Message({
  userId,
  token,
  entries = [],
  selectedRecipeId = null,
  quantity = 1
} = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "cook.recipe_picker";

  const selectedId = String(selectedRecipeId || "").trim();
  const safeQuantity = clampQuantity(quantity);
  const selectedEntry = (entries || []).find((entry) => String(entry?.recipeId || "") === selectedId) || null;

  const components = [
    text("## Cook Recipe Picker"),
    text("Select a recipe and quantity, then cook.")
  ];

  if (!entries.length) {
    components.push(text("No recipes are available to cook right now."));
  } else {
    for (const entry of entries.slice(0, 10)) {
      const recipeId = String(entry?.recipeId || "").trim();
      if (!recipeId) continue;
      const isSelected = selectedId === recipeId;
      components.push({
        type: 9,
        components: [text(String(entry?.line || recipeId))],
        accessory: button({
          sceneKey,
          actionKey: "sel",
          userId: safeUserId,
          token: safeToken,
          arg: recipeId,
          label: isSelected ? "Selected" : "Select",
          style: isSelected ? 3 : 1
        })
      });
    }

    components.push(text(`Quantity: **${safeQuantity}**`));
    components.push({
      type: 1,
      components: [
        button({ sceneKey, actionKey: "qty", userId: safeUserId, token: safeToken, arg: "m5", label: "-5" }),
        button({ sceneKey, actionKey: "qty", userId: safeUserId, token: safeToken, arg: "m1", label: "-1" }),
        button({ sceneKey, actionKey: "qty", userId: safeUserId, token: safeToken, arg: "p1", label: "+1" }),
        button({ sceneKey, actionKey: "qty", userId: safeUserId, token: safeToken, arg: "p5", label: "+5" })
      ]
    });
  }

  components.push({
    type: 1,
    components: [
      button({
        sceneKey,
        actionKey: "go",
        userId: safeUserId,
        token: safeToken,
        label: selectedEntry ? "Cook" : "Select Recipe First",
        style: 3,
        disabled: !selectedEntry
      }),
      button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 })
    ]
  });

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{ type: 17, components }]
  };
}

export function buildCookMinigameV2Message({
  userId,
  token,
  recipeName,
  quantity = 1,
  turnIndex = 0,
  totalTurns = 1,
  score = 0,
  misses = 0,
  targetAction = "prep",
  turnMs = 2200,
  graceMs = 650,
  lastTurnStatus = null
} = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const safeTurns = Math.max(1, Math.floor(Number(totalTurns) || 1));
  const safeTurnIndex = Math.max(0, Math.min(safeTurns, Math.floor(Number(turnIndex) || 0)));
  const safeScore = clampScore(score, safeTurns);
  const safeMisses = Math.max(0, Math.floor(Number(misses) || 0));
  const safeQuantity = clampQuantity(quantity);
  const safeTurnMs = Math.max(250, Math.floor(Number(turnMs) || 2200));
  const safeGraceMs = Math.max(0, Math.floor(Number(graceMs) || 650));
  const actionLabelByKey = {
    prep: "Prep",
    heat: "Heat",
    plate: "Plate",
    serve: "Serve"
  };
  const target = String(targetAction || "prep").trim().toLowerCase();
  const targetLabel = actionLabelByKey[target] ?? "Prep";
  const statusLabelByKey = {
    hit: "Hit",
    wrong_action: "Miss (wrong action)",
    late: "Miss (late tap)"
  };
  const statusLabel = statusLabelByKey[String(lastTurnStatus || "").trim().toLowerCase()] ?? null;
  const sceneKey = "cook.minigame";

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{
      type: 17,
      components: [
        text("## Kitchen Line"),
        text(`Recipe: **${String(recipeName || "Unknown Dish")}** • Quantity: **${safeQuantity}**`),
        text(`Turn **${Math.min(safeTurnIndex + 1, safeTurns)}/${safeTurns}** • Target action: **${targetLabel}**`),
        text(`Pace: **${(safeTurnMs / 1000).toFixed(1)}s** + **${(safeGraceMs / 1000).toFixed(1)}s** grace`),
        text(`Hits: **${safeScore}** • Misses: **${safeMisses}**`),
        ...(statusLabel ? [text(`Last turn: **${statusLabel}**`)] : []),
        {
          type: 1,
          components: [
            button({ sceneKey, actionKey: "prep", userId: safeUserId, token: safeToken, label: "Prep", style: 1 }),
            button({ sceneKey, actionKey: "heat", userId: safeUserId, token: safeToken, label: "Heat", style: 1 }),
            button({ sceneKey, actionKey: "plate", userId: safeUserId, token: safeToken, label: "Plate", style: 1 }),
            button({ sceneKey, actionKey: "serve", userId: safeUserId, token: safeToken, label: "Serve", style: 1 })
          ]
        },
        {
          type: 1,
          components: [
            button({ sceneKey, actionKey: "bk", userId: safeUserId, token: safeToken, label: "Back", style: 2 })
          ]
        }
      ]
    }]
  };
}

export function buildCookResultV2Message({
  userId,
  token,
  title = "## Cook Result",
  summaryLines = []
} = {}) {
  const safeUserId = String(userId || "").trim();
  const safeToken = String(token || "").trim();
  const sceneKey = "cook.result";
  const lines = (summaryLines || []).filter(Boolean).map((line) => String(line));

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    components: [{
      type: 17,
      components: [
        text(title),
        ...(lines.length ? lines.map((line) => text(line)) : [text("Cook result unavailable.")]),
        {
          type: 1,
          components: [
            button({ sceneKey, actionKey: "ord", userId: safeUserId, token: safeToken, label: "Orders", style: 1 }),
            button({ sceneKey, actionKey: "cook", userId: safeUserId, token: safeToken, label: "Cook Again", style: 3 }),
            button({ sceneKey, actionKey: "serve", userId: safeUserId, token: safeToken, label: "Serve", style: 2 })
          ]
        }
      ]
    }]
  };
}
