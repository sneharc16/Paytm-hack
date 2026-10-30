// src/lib/privacy/mask.ts: personal data out before any model call or voice output, back in only on our side.
// mask() swaps each item for a typed, numbered token (<PHONE_1>); the same value always gets the same token
// within one vault. unmask() puts values back, never secrets (OTPs, PINs). Pure: no I/O, no clock, no random.
// The vault keeps values in a private field and serialises to counts only, so logging it leaks nothing.

export type PiiType = "PHONE" | "UPI" | "EMAIL" | "ACCOUNT" | "IFSC" | "PAN" | "AADHAAR" | "CARD" | "SECRET" | "NAME";

export const PII_LABEL: Record<PiiType, string> = {
  PHONE: "phone", UPI: "UPI ID", EMAIL: "email", ACCOUNT: "bank account", IFSC: "IFSC", PAN: "PAN",
  AADHAAR: "Aadhaar", CARD: "card number", SECRET: "OTP or PIN", NAME: "name",
};

/** Kept as they are: the message needs them and they are not personal. Checked before any detector runs. */
export const ALLOWLIST: { what: string; re: RegExp }[] = [
  { what: "rupee amounts", re: /(?:₹|Rs\.?\s?|INR\s?)[\d०-९][\d०-९,]*(?:\.\d{1,2})?/giu },
  { what: "case IDs", re: /\bPAK-\d{4}\b/g },
  { what: "cybercrime helpline", re: /(?<![\d०-९])(?:1930|१९३०)(?![\d०-९])/gu },
  { what: "times", re: /\b\d{1,2}[:.]\d{2}\s?(?:AM|PM|am|pm)?\b/g },
  { what: "dates", re: /\b\d{1,2}(?:\s|-)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s\d{4})?\b/gi },
  { what: "ISO dates", re: /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g },
  { what: "tokens already masked", re: /<(?:PHONE|UPI|EMAIL|ACCOUNT|IFSC|PAN|AADHAAR|CARD|SECRET|NAME)_\d+>/g },
];

const TOKEN_RE = /<(PHONE|UPI|EMAIL|ACCOUNT|IFSC|PAN|AADHAAR|CARD|SECRET|NAME)_(\d+)>/g;

export class Vault {
  #byToken = new Map<string, string>();
  #byKey = new Map<string, string>();
  #n: Partial<Record<PiiType, number>> = {};

  token(type: PiiType, value: string, key = value.toLowerCase()): string {
    const k = `${type}|${key}`;
    const hit = this.#byKey.get(k);
    if (hit) return hit;
    const n = (this.#n[type] ?? 0) + 1;
    this.#n[type] = n;
    const t = `<${type}_${n}>`;
    this.#byKey.set(k, t);
    this.#byToken.set(t, value);
    return t;
  }
  has(token: string) { return this.#byToken.has(token); }
  value(token: string) { return this.#byToken.get(token); }
  /** How many distinct items of each type were masked. Safe to log and to store. */
  counts(): Partial<Record<PiiType, number>> { return { ...this.#n }; }
  get size() { return this.#byToken.size; }
  toJSON() { return { masked: this.counts() }; }
}

const DEV = "०१२३४५६७८९";
/** Same length as the input (Devanagari digits are one UTF-16 unit each), so match positions carry over. */
const asciiDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(DEV.indexOf(d)));
const digitsOnly = (s: string) => asciiDigits(s).replace(/\D/g, "");

function luhn(num: string): boolean {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const ND = "(?<![\\d\\w])"; // not after a digit or letter
const NA = "(?![\\d\\w])"; // not before one

interface Detector {
  type: PiiType;
  re: RegExp;
  /** Which capture group is the value (0 = whole match). */
  group?: number;
  accept?: (value: string) => boolean;
  key?: (value: string) => string;
}

// Order matters: each detector sees the text with earlier finds already replaced by tokens.
const DETECTORS: Detector[] = [
  // Secrets: the digits next to OTP, PIN or password, on either side. Never unmasked.
  { type: "SECRET", re: /(?<!\p{L})(?:otp|o\.t\.p|pin|upi pin|mpin|password|passcode|pass code|cvv|ओटीपी|पिन|पासवर्ड)(?![\p{L}\p{M}])[^\d\n]{0,16}?(\d{4,6})(?!\d)/giu, group: 1 },
  { type: "SECRET", re: /(?<!\d)(\d{4,6})(?!\d)[^\d\n]{0,12}?(?<!\p{L})(?:otp|pin|password|ओटीपी|पिन)(?![\p{L}\p{M}])/giu, group: 1 },
  // Emails before UPI IDs: an email has a dot after the @.
  { type: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { type: "UPI", re: /[A-Za-z0-9._-]{1,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![.\w])/g },
  { type: "IFSC", re: new RegExp(`${ND}[A-Za-z]{4}0[A-Za-z0-9]{6}${NA}`, "g"), accept: (v) => /\d/.test(v.slice(5)), key: (v) => v.toUpperCase() },
  { type: "PAN", re: new RegExp(`${ND}[A-Za-z]{5}\\d{4}[A-Za-z]${NA}`, "g"), accept: (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v) || /^[a-z]{5}\d{4}[a-z]$/.test(v), key: (v) => v.toUpperCase() },
  // Bank accounts: 9 to 18 digits near an account word.
  { type: "ACCOUNT", re: /(?:account|a\/c|acct|ac no|acc no|khata|khaata|खाता|खाते)[^\d\n]{0,20}?((?:\d[\s-]?){8,17}\d)(?!\d)/giu, group: 1, key: digitsOnly },
  // Cards: 13 to 19 digits, optionally grouped, that pass the Luhn check.
  { type: "CARD", re: /(?<!\d)(?:\d[\s-]?){12,18}\d(?!\d)/g, accept: (v) => { const d = digitsOnly(v); return d.length >= 13 && d.length <= 19 && luhn(d); }, key: digitsOnly },
  // Aadhaar: 12 digits in groups of four (first 2 to 9), or 12 in a row next to the word.
  { type: "AADHAAR", re: /(?<!\d)[2-9]\d{3}[\s-]\d{4}[\s-]\d{4}(?!\d)/g, key: digitsOnly },
  { type: "AADHAAR", re: /(?:aadhaar|aadhar|adhar|आधार)[^\d\n]{0,16}?([2-9]\d{11})(?!\d)/giu, group: 1, key: digitsOnly },
  // Indian mobiles: +91 / 91 / 0 prefix optional, starting 6 to 9, spaces or dashes allowed between digits.
  { type: "PHONE", re: /(?<![\d+])(?:\+91[\s-]?|91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?!\d)/g, key: (v) => digitsOnly(v).slice(-10) },
  // Any other long run of digits is treated as an account number: an unexplained 9 to 18 digit number is not
  // something a reminder or a summary needs.
  { type: "ACCOUNT", re: /(?<!\d)\d{9,18}(?!\d)/g, key: digitsOnly },
];

export interface MaskOptions {
  /** Names we hold for this customer (full names; each part of 3 or more letters is matched on its own too). */
  names?: string[];
  /** Words to keep even if a detector would match them (brands, registered names). */
  keep?: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function maskString(text: string, vault: Vault, opts: MaskOptions): string {
  // 1. Protect allowlisted spans with one private-use character each, so no detector can see inside them.
  const kept: string[] = [];
  const protect = (s: string, re: RegExp) => s.replace(re, (m) => { kept.push(m); return String.fromCharCode(0xe000 + kept.length - 1); });
  let s = text;
  for (const k of opts.keep ?? []) if (k.trim().length >= 2) s = protect(s, new RegExp(escapeRe(k), "giu"));
  for (const a of ALLOWLIST) s = protect(s, a.re);

  // 2. Detectors, in order. Matching runs on an ASCII-digit copy; replacement uses the original text.
  for (const d of DETECTORS) {
    const asc = asciiDigits(s);
    let out = "", last = 0;
    for (const m of asc.matchAll(new RegExp(d.re.source, d.re.flags))) {
      const g = d.group ?? 0;
      const val = m[g];
      if (!val) continue;
      const start = m.index! + (g ? m[0].indexOf(val) : 0);
      const original = s.slice(start, start + val.length);
      if (d.accept && !d.accept(asciiDigits(original))) continue;
      out += s.slice(last, start) + vault.token(d.type, original.trim(), (d.key ?? ((v: string) => v.toLowerCase()))(original.trim()));
      last = start + val.length;
    }
    s = out + s.slice(last);
  }

  // 3. Names we hold for this customer: the full name first, then each part.
  const parts = new Set<string>();
  for (const full of opts.names ?? []) {
    const f = full.trim();
    if (!f) continue;
    s = s.replace(new RegExp(`(?<![\\p{L}])${escapeRe(f)}(?![\\p{L}])`, "giu"), (m) => vault.token("NAME", m, f.toLowerCase()));
    for (const p of f.split(/\s+/)) if (p.length >= 3) parts.add(p);
  }
  for (const p of parts) s = s.replace(new RegExp(`(?<![\\p{L}])${escapeRe(p)}(?![\\p{L}])`, "giu"), (m) => vault.token("NAME", m, p.toLowerCase()));

  // 4. Put the protected spans back.
  return s.replace(/[-]/g, (c) => kept[c.charCodeAt(0) - 0xe000] ?? c);
}

/** Mask a string, or every string inside an object or array (keys are left alone). */
export function mask<T>(input: T, opts: MaskOptions = {}, vault = new Vault()): { masked: T; vault: Vault } {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return maskString(v, vault, opts);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { masked: walk(input) as T, vault };
}

/** Put real values back. Secrets stay hidden. Unknown tokens are left as they are (callers reject them first). */
export function unmask<T>(input: T, vault: Vault): T {
  const one = (s: string) => s.replace(TOKEN_RE, (t, type: PiiType) => (type === "SECRET" ? "••••" : vault.value(t) ?? t));
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return one(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(input) as T;
}

/** Every token in a text, in order. */
export const tokensIn = (s: string) => [...s.matchAll(TOKEN_RE)].map((m) => ({ token: m[0], type: m[1] as PiiType }));

/** What would be masked in this text (types only), for checks on model output and voice scripts. */
export function piiIn(s: string, opts: MaskOptions = {}): PiiType[] {
  const v = new Vault();
  maskString(s, v, opts);
  return Object.keys(v.counts()) as PiiType[];
}

/** "2 masked: phone, UPI ID" (counts only, never values). */
export function describeMasked(counts: Partial<Record<PiiType, number>> | undefined): string {
  const order = Object.keys(PII_LABEL);
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  if (!entries.length) return "Nothing personal to mask";
  const total = entries.reduce((a, [, n]) => a + (n ?? 0), 0);
  return `${total} masked: ${entries.map(([t]) => PII_LABEL[t as PiiType]).join(", ")}`;
}
