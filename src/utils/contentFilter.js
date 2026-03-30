/**
 * Blocks token symbol/name when a listed term appears as a whole word only
 * (word boundaries), so substrings like "pass" / "class" are not flagged.
 */

const BLOCKED_WORDS = [
  "ASS",
  "SHIT",
  "FUCK",
  "PUSSY",
  "DICK",
  "CUM",
  "BALLS",
  "FAG",
  "FAGGOT",
  "NIGGA",
  "NIGGER",
  "TIT",
  "TITTY",
  "TITS",
  "BULLSHIT",
  "TITTIE",
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Longer tokens first so alternation prefers e.g. FAGGOT over FAG when overlapping (defensive)
const SORTED = [...BLOCKED_WORDS].sort((a, b) => b.length - a.length);

const BLOCKED_WORD_PATTERN = new RegExp(
  `\\b(?:${SORTED.map(escapeRegex).join("|")})\\b`,
  "i"
);

export function textContainsBlockedWord(text) {
  if (text == null || typeof text !== "string") return false;
  return BLOCKED_WORD_PATTERN.test(text);
}

/** True if both symbol and name are allowed (no blocked whole words). */
export function tokenContentAllowed(symbol, name) {
  return (
    !textContainsBlockedWord(String(symbol ?? "")) &&
    !textContainsBlockedWord(String(name ?? ""))
  );
}
