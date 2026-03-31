const BLOCKED_WORDS = [
  "SHIT",
  "FUCK",
  "BITCH",
  "CUNT",
  "DYKE",
  "KIKE",
  "CHINK",
  "NIGGER",
  "NIGGA",
  "DICK",
  "COCK",
  "PENIS",
  "VAGINA",
  "PUSSY",
  "PUSSIE",
  "CUM",
  "TITS",
  "TITTY",
  "TITTIE",
  "ASSHOLE",
  "FAG",
  "FAGGOT",
];

function normalizeForBlockedCheck(text) {
  if (text == null || typeof text !== "string") return "";
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

const NORMALIZED_BLOCKED_WORDS = BLOCKED_WORDS.map(normalizeForBlockedCheck).sort(
  (a, b) => b.length - a.length
);

export function textContainsBlockedWord(text) {
  const normalized = normalizeForBlockedCheck(text);
  if (!normalized) return false;
  return NORMALIZED_BLOCKED_WORDS.some((blocked) => normalized.includes(blocked));
}

/** True if both symbol and name are allowed after compact substring blocking. */
export function tokenContentAllowed(symbol, name) {
  return (
    !textContainsBlockedWord(String(symbol ?? "")) &&
    !textContainsBlockedWord(String(name ?? ""))
  );
}
