// PRD 21.2. Matched case-insensitively as whole words or phrases.
export const BANNED = [
  "scam", "fraud", "trap", "cheat", "dhokha", "illegal", "galti", "warning", "turant", "jaldi karein",
  "abhi nahi toh kabhi nahi", "last chance", "hurry", "guaranteed", "100% safe",
  "धोखा", "गलती", "ग़लती", "तुरंत", "जल्दी करें", "चेतावनी", "अवैध", "फ्रॉड",
];

export function bannedWordsIn(s: string): string[] {
  const lower = s.toLowerCase();
  return BANNED.filter((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu").test(lower));
}
