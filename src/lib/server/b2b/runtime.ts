// Loading and changing a live company. Every change runs the pure engine on the replayed ledger at wall-clock
// time and appends only the new events, if nobody else appended first; on a clash it reloads and runs again
// (the engine is deterministic for the same ledger, time and input).
import { loadOrg } from "@/b2b/live";
import type { Treasury } from "@/b2b/treasury";
import { after } from "next/server";
import { b2bStore, ConflictError } from "./store";
import { deliverWebhooks } from "./webhooks";

/** Send webhooks after the response when inside a request; otherwise (scripts, tests) in the background. */
function notify(t: Treasury, fresh: import("@/b2b/types").LedgerEvent[]) {
  const job = () => deliverWebhooks(t, fresh).then(() => undefined, () => undefined);
  try { after(job); } catch { void job(); }
}

const cache = new Map<string, Treasury>();
export const nowIso = () => new Date().toISOString();

export async function readOrg(orgId: string): Promise<Treasury | null> {
  const events = await b2bStore().events(orgId);
  if (!events.length) return null;
  const hit = cache.get(orgId);
  if (hit && hit.events.length === events.length && hit.head === events.at(-1)!.hash) return hit;
  const t = loadOrg(events);
  cache.set(orgId, t);
  return t;
}

export class NotFound extends Error {}

/** Run `fn` against the company at `now`, persisting whatever events it (and the clock) produced. */
export async function writeOrg<R>(orgId: string, fn: (t: Treasury, now: string) => R): Promise<R> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const t = await readOrg(orgId);
    if (!t) throw new NotFound(orgId);
    const before = t.events.length;
    const now = nowIso();
    let result: R;
    try {
      t.advance(now);
      result = fn(t, now);
    } catch (e) {
      cache.delete(orgId);
      throw e;
    }
    const fresh = t.events.slice(before);
    if (!fresh.length) return result;
    try {
      await b2bStore().append(orgId, before, fresh);
      notify(t, fresh);
      return result;
    } catch (e) {
      cache.delete(orgId);
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new ConflictError("Too many concurrent writers");
}

/** Persist a brand new company's first events. */
export async function createOrgLedger(t: Treasury) {
  await b2bStore().append(t.companyId, 0, t.events);
  cache.set(t.companyId, t);
}

/** Cron: let every company's clock run (timers, cooling, timelocks, bank status checks, anchors). */
export async function tickAll(): Promise<{ orgs: number; events: number }> {
  let events = 0;
  const ids = await b2bStore().orgIds();
  for (const id of ids) {
    const before = (await readOrg(id))?.events.length ?? 0;
    const after = await writeOrg(id, (t) => t.events.length);
    events += after - before;
  }
  return { orgs: ids.length, events };
}
