// src/engine/namegap.ts (PRD 11.3)
const STOP = new Set(["pvt","private","ltd","limited","llp","india","services","service","technologies","technology","digital","media","the","and","co","company","solutions"]);

export function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2") // PadhoAI -> Padho AI
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export function hasNameGap(brand: string, legal: string): boolean {
  const b = new Set(tokens(brand));
  return !tokens(legal).some((t) => b.has(t));
}
