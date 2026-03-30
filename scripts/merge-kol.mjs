/**
 * Merges scripts/kol-base.json + wallets-import.json → src/constants/kolWallets.js
 * Run: node scripts/merge-kol.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/** Preserve checklist order for names that existed before this merge. */
const LEGACY_NAME_ORDER = [
  "BATMANWIF",
  "TEST ADDY",
  "ERIK STEPHENS",
  "ANSEM",
  "MARCEL",
  "BASTILLE",
  "TRADERPOW",
  "MITCH",
  "XANDER",
  "BIG DAN",
  "FRANKDEGODS",
  "TOLY WALLET",
  "PATTY ICE",
  "EURIS",
  "DAVE PORTNOY",
  "POSSIBLE ALPHA",
  "WHALEEEEE",
  "GAKE",
  "CUPSEY",
  "LOG MAIN",
  "DANI",
  "ELITE FNF4",
  "ELITE FNF3",
  "ILY4",
  "ILY3",
  "ILY2",
  "MARCEL2",
  "MARCELL",
  "ELITE FNF2",
  "ELITE FNF1",
  "LEXAPRO",
  "ITAY FRONTRUN",
  "SCANNOORS WALLET",
  "LOGURTAXIOM",
  "Logurt2",
  "CASINO",
  "DJEN",
  "LOGURT",
  "Logurt",
  "Loggypoo",
  "ILY",
  "EARLY WHALE",
  "GAKE SIDE",
  "HIGH PNL WR",
  "HIGH PNL WR ALT",
];

function sanitizeKolDisplayName(raw) {
  if (raw == null || raw === "") return "Wallet";
  let s = String(raw).trim();
  s = s.replace(/^\uFEFF/, "");
  s = s.replace(/^["']+|["']+$/g, "");
  s = s.replace(/\\"/g, '"');
  if (/alvin/i.test(s) && /patty/i.test(s)) s = "Alvin Patty";
  if (/^\\?"?CUPSEY NEW/i.test(s)) s = "CUPSEY";

  const rules = [
    [/\bkunt\b/gi, "Trader"],
    [/good\s+ass\s+trader/gi, "Good trader"],
    [/yomama/gi, "Meme"],
    [/mogged\s+jeet/gi, "Jeet wallet"],
    [/mogged\s+clipper|mogged\s+clipepr/gi, "Clipper wallet"],
    [/mogged\s+on\s+pump/gi, "Pump wallet"],
  ];
  for (const [re, rep] of rules) s = s.replace(re, rep);

  const blocked = ["fuck", "shit", "cunt", "nigg", "rape", "porn"];
  let lower = s.toLowerCase();
  for (const b of blocked) {
    if (lower.includes(b)) {
      s = s.replace(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").replace(/\s+/g, " ").trim();
      lower = s.toLowerCase();
    }
  }

  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "Wallet";
  return s;
}

function loadImportRows() {
  const p = join(__dirname, "wallets-import.json");
  let text = readFileSync(p, "utf8");
  text = text.replace(/^\uFEFF/, "").trim();
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("wallets-import.json must be a JSON array");
  return rows;
}

function formatJsObject(obj) {
  const keys = Object.keys(obj).sort();
  const lines = keys.map((k) => {
    const key = /^[a-zA-Z_$][\w$]*$/.test(k) && !/^\d/.test(k) ? k : JSON.stringify(k);
    const val = JSON.stringify(obj[k]);
    return `  ${key}: ${val},`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

function buildAllKolNames(mergedNames) {
  const present = new Set(Object.values(mergedNames));
  const ordered = [];
  for (const n of LEGACY_NAME_ORDER) {
    if (present.has(n)) {
      ordered.push(n);
      present.delete(n);
    }
  }
  const rest = [...present].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return [...ordered, ...rest];
}

function main() {
  const basePath = join(__dirname, "kol-base.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  const rows = loadImportRows();

  const imported = {};
  for (const row of rows) {
    const addr = row.trackedWalletAddress;
    if (!addr || typeof addr !== "string") continue;
    imported[addr.trim()] = sanitizeKolDisplayName(row.name);
  }

  const merged = { ...base, ...imported };
  const allNames = buildAllKolNames(merged);

  const header = `/**
 * Smart wallet address → display name (BullX stream + PumpFun WS).
 * Multiple addresses may share one display name (e.g. DAVE PORTNOY).
 * Generated in part by scripts/merge-kol.mjs (kol-base + wallets-import).
 */

`;

  const body = `export const KOL_NAMES = ${formatJsObject(merged)};

/** Unique display names for the filter checklist (legacy order first, then A–Z). */
export const ALL_KOL_NAMES = ${JSON.stringify(allNames, null, 2)};

export const KOL_WALLET_ADDRESSES = Object.freeze(Object.keys(KOL_NAMES));
`;

  const outPath = join(root, "src", "constants", "kolWallets.js");
  writeFileSync(outPath, header + body, "utf8");
  console.log("Wrote", outPath);
  console.log("Addresses:", Object.keys(merged).length, "import rows:", rows.length);
}

main();
