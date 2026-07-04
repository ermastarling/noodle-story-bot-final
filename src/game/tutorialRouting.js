import { getCurrentTutorialStep } from "./tutorial.js";

const NAV_SUB_RULES = {
  // UI nav should open forage menu in normal flow, but execute forage directly during tutorial step.
  forage: {
    defaultSub: "forage_menu",
    tutorialOverrides: {
      intro_forage: "forage"
    }
  },
  // UI nav should always open fishing menu (never immediately execute fishing action).
  fishing: {
    defaultSub: "fishing_menu"
  }
};

const TUTORIAL_GATE_RULES = {
  acceptPickerShowBackButton: {
    defaultValue: true,
    tutorialOverrides: {
      intro_order: false
    }
  },
  buyMenuShowSellButton: {
    defaultValue: true,
    tutorialOverrides: {
      intro_market: false
    }
  },
  cookPickerShowOrdersActions: {
    defaultValue: true,
    tutorialOverrides: {
      intro_cook: false
    }
  },
  servePickerShowOrdersActions: {
    defaultValue: true,
    tutorialOverrides: {
      intro_serve: false
    }
  },
  showTutorialBuyRowAfterAccept: {
    defaultValue: false,
    tutorialOverrides: {
      intro_market: true
    }
  },
  showTutorialForageRowAfterBuy: {
    defaultValue: false,
    tutorialOverrides: {
      intro_forage: true
    }
  },
  showTutorialCookRowAfterForage: {
    defaultValue: false,
    tutorialOverrides: {
      intro_cook: true
    }
  },
  showTutorialServeRowAfterCook: {
    defaultValue: false,
    tutorialOverrides: {
      intro_serve: true
    }
  },
  limitMultiBuyToBuy1: {
    defaultValue: false,
    tutorialOverrides: {
      intro_market: true
    }
  },
  multiBuySelectionShowSellButton: {
    defaultValue: true,
    tutorialOverrides: {
      intro_market: false
    }
  },
  showTutorialForageRowAfterMultiBuyPurchase: {
    defaultValue: false,
    tutorialOverrides: {
      intro_forage: true
    }
  }
};

const TUTORIAL_PROGRESS_ROW_RULES = {
  intro_order: "accept_only",
  intro_market: "buy",
  intro_forage: "forage",
  intro_cook: "cook",
  intro_serve: "serve"
};

const TUTORIAL_RECOVERY_SUB_RULES = {
  intro_order: "orders",
  intro_market: "buy",
  intro_forage: "forage",
  intro_cook: "cook",
  intro_serve: "serve"
};

export function getTutorialStepId(player) {
  if (!player || typeof player !== "object" || Array.isArray(player)) return null;
  return getCurrentTutorialStep(player)?.id ?? null;
}

export function isTutorialStep(player, stepId) {
  return getTutorialStepId(player) === stepId;
}

export function resolveTutorialGateValue({ player, gate, fallbackValue = null } = {}) {
  const rule = TUTORIAL_GATE_RULES[gate];
  if (!rule) return fallbackValue;

  const stepId = getTutorialStepId(player);
  if (stepId && Object.prototype.hasOwnProperty.call(rule.tutorialOverrides ?? {}, stepId)) {
    return rule.tutorialOverrides[stepId];
  }

  return Object.prototype.hasOwnProperty.call(rule, "defaultValue")
    ? rule.defaultValue
    : fallbackValue;
}

export function resolveTutorialProgressRowKey(player) {
  const stepId = getTutorialStepId(player);
  if (!stepId) return null;
  return TUTORIAL_PROGRESS_ROW_RULES[stepId] ?? null;
}

export function resolveNavSubForTutorial({ player, action, fallbackSub = action } = {}) {
  const rule = NAV_SUB_RULES[action];
  if (!rule) return fallbackSub;

  const stepId = getTutorialStepId(player);
  if (stepId && rule.tutorialOverrides?.[stepId]) {
    return rule.tutorialOverrides[stepId];
  }
  return rule.defaultSub ?? fallbackSub;
}

export function resolveForageNavSub(player) {
  return resolveNavSubForTutorial({ player, action: "forage", fallbackSub: "forage_menu" });
}

export function resolveTutorialRecoverySub({ player, fallbackSub = "orders" } = {}) {
  const stepId = getTutorialStepId(player);
  if (!stepId) return fallbackSub;
  return TUTORIAL_RECOVERY_SUB_RULES[stepId] ?? fallbackSub;
}