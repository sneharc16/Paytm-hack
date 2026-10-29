// src/b2b/gstin.ts: GSTIN and PAN shape checks. A GSTIN is state code (2) + PAN (10) + entity (1) + "Z" + a
// mod-36 check character, so a single mistyped or tampered character is caught before any payment is planned.
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) return "?";
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export const isPan = (pan: string) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);

export function isGstin(g: string): boolean {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

export const panOfGstin = (g: string) => g.slice(2, 12);

export function makeGstin(stateCode: string, pan: string, entity = "1"): string {
  const first = `${stateCode}${pan}${entity}Z`;
  return first + gstinCheckChar(first);
}
