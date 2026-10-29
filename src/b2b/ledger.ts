// src/b2b/ledger.ts: the append-only, hash-chained ledger. Each event commits to the one before it, so editing,
// dropping or reordering any past event breaks every hash after it. The head hash is anchored once a day
// (an "anchor" event), the stand-in for sending it to the auditor or a notary outside the company.
import { canonical, dhash } from "./crypto";
import type { LedgerEvent } from "./types";

export const GENESIS = "0".repeat(64);

export const eventHash = (e: Omit<LedgerEvent, "hash">) =>
  dhash("ledger", `${e.prev}|${canonical({ seq: e.seq, at: e.at, companyId: e.companyId, type: e.type, actor: e.actor, ruleId: e.ruleId ?? null, payload: e.payload })}`);

/** Returns the first broken sequence number, or null when the whole chain checks out. */
export function verifyChain(events: LedgerEvent[]): { ok: true; head: string } | { ok: false; brokenAt: number; reason: string } {
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) return { ok: false, brokenAt: e.seq, reason: `Expected event ${i + 1}, found ${e.seq}` };
    if (e.prev !== prev) return { ok: false, brokenAt: e.seq, reason: "Link to the previous event does not match" };
    let h: string;
    try { h = eventHash(e); } catch { return { ok: false, brokenAt: e.seq, reason: "Event cannot be encoded" }; }
    if (h !== e.hash) return { ok: false, brokenAt: e.seq, reason: "Event content was changed after it was written" };
    prev = e.hash;
  }
  return { ok: true, head: prev };
}
