export function getEventRegistry(eventsContent) {
  const events = eventsContent?.events ?? [];
  return new Map(events.map((event) => [String(event.event_id), event]));
}

export function getEventById(eventsContent, eventId) {
  if (!eventId) return null;
  const registry = getEventRegistry(eventsContent);
  return registry.get(String(eventId)) ?? null;
}

function parseMonthDay(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function buildUtcDate(year, month, day, endOfDay = false) {
  if (endOfDay) {
    return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  }
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

export function getEventWindow(event, nowMs = Date.now()) {
  const startMd = parseMonthDay(event?.start_at);
  const endMd = parseMonthDay(event?.end_at);
  if (!startMd || !endMd) return { start: null, end: null };

  const year = new Date(nowMs).getUTCFullYear();
  const crossesYear = endMd.month < startMd.month || (endMd.month === startMd.month && endMd.day < startMd.day);

  const startCurrent = buildUtcDate(year, startMd.month, startMd.day);
  const endCurrent = buildUtcDate(year + (crossesYear ? 1 : 0), endMd.month, endMd.day, true);

  if (nowMs >= startCurrent && nowMs <= endCurrent) {
    return { start: startCurrent, end: endCurrent };
  }

  const startPrev = buildUtcDate(year - 1, startMd.month, startMd.day);
  const endPrev = buildUtcDate(year - 1 + (crossesYear ? 1 : 0), endMd.month, endMd.day, true);
  if (nowMs >= startPrev && nowMs <= endPrev) {
    return { start: startPrev, end: endPrev };
  }

  return { start: startCurrent, end: endCurrent };
}

export function getActiveEvent(eventsContent, serverState) {
  const eventId = serverState?.active_event_id;
  return getEventById(eventsContent, eventId);
}

export function getActiveEventEffects(eventsContent, serverState) {
  const activeEvent = getActiveEvent(eventsContent, serverState);
  return activeEvent?.effects ?? null;
}

export function getActiveEventRecipes(eventsContent, serverState) {
  const activeEvent = getActiveEvent(eventsContent, serverState);
  return activeEvent?.event_recipes ?? [];
}

export function buildEventRecipesIndex(eventsContent) {
  const events = eventsContent?.events ?? [];
  const index = {};

  for (const event of events) {
    const recipes = event?.event_recipes ?? [];
    for (const recipe of recipes) {
      if (!recipe?.recipe_id) continue;
      index[recipe.recipe_id] = {
        ...recipe,
        event_id: event.event_id,
        event_badge_id: event.badge_id ?? null,
        is_event_recipe: true
      };
    }
  }

  return index;
}

export function withEventRecipes(content, eventsContent) {
  const eventRecipes = buildEventRecipesIndex(eventsContent);
  if (!Object.keys(eventRecipes).length) return content;

  return {
    ...content,
    recipes: {
      ...(content?.recipes ?? {}),
      ...eventRecipes
    }
  };
}
