const PROFANITY_WORDS = new Set([
  "fuck",
  "fucker",
  "fucking",
  "shit",
  "shitty",
  "bitch",
  "bastard",
  "asshole",
  "dick",
  "cunt",
  "piss",
  "nig",
  "nigga",
  "nigger",
  "retard",
  "retarded",
  "slut",
  "whore",
  "douche",
  "douchebag",
  "motherfucker",
  "mothafucka",
  "motherfucking",
  "motherfuck",
  "hate",
  "kill",
  "killing",
  "killed",
  "killer",
  "die",
  "dying",
  "died",
  "dies",
  "bitchass",
  "ass",
  "shit",
  "shitass",
  "shithead",
  "shitface",
  "dumbass",
  "puss",
  "pussy",
  "pussybitch",
  "fag",
  "faggot",
  "hitler",
  "trump"
]);

const LEET_MAP = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s"
};

function normalizeToken(token) {
  const lower = String(token || "").toLowerCase();
  const chars = [];
  for (const ch of lower) {
    const mapped = LEET_MAP[ch] ?? ch;
    if (mapped >= "a" && mapped <= "z") {
      chars.push(mapped);
    }
  }
  if (!chars.length) return "";
  const collapsed = chars.join("").replace(/(.)\1{2,}/g, "$1$1");
  return collapsed;
}

export function containsProfanity(text) {
  if (!text) return false;
  const rough = String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tokens = rough.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const norm = normalizeToken(token);
    if (!norm) continue;
    if (PROFANITY_WORDS.has(norm)) return true;
  }
  return false;
}
