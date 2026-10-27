// Plays the whole story against the configured Supabase project and reads it back from scratch.
// Usage: pnpm check:supabase   (uses .env.local; creates and then restarts session CHECK-1)
import { DEMO_END, ist } from "@/engine/clock";
import { metrics } from "@/engine/metrics";
import { ingest, Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { clockCommand, command, eventsSince } from "@/lib/server/sessions";
import { getStore, setStoreForTests } from "@/lib/server/store";

async function main() {
  const store = getStore();
  if (store.kind !== "supabase") throw new Error("Supabase keys not set");
  const id = "CHECK-1";
  const t0 = Date.now();
  await clockCommand(id, { action: "restart" });
  await clockCommand(id, { action: "jump", value: ist("2026-10-26 21:11") });
  const world = generateWorld("2711");
  const sunita = world.cycles.find((c) => c.group === "ask" && world.mandates.find((m) => m.id === c.mandateId)!.userId === "u_sunita")!;
  const r = await command(id, { kind: "customer_decision", cycleId: sunita.id, choice: "skip" });
  console.log("Sunita's skip:", r);
  await clockCommand(id, { action: "jump", value: DEMO_END });
  console.log(`Story written in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // A cold "second server": new store client, empty replica, everything read from the database.
  setStoreForTests(undefined);
  (globalThis as unknown as { __pakka?: { replicas: Map<string, unknown> } }).__pakka?.replicas.clear();
  const t1 = Date.now();
  const d = await eventsSince(id, 0, 0);
  const s = new Session(id, world);
  ingest(s, d.events);
  const m = metrics(s);
  console.log(`Read back ${d.events.length} events in ${((Date.now() - t1) / 1000).toFixed(1)} s, epoch ${d.epoch}`);
  console.log("Gap-free:", d.events.every((e, i) => e.id === i + 1));
  console.log({ unwantedStopped: m.unwantedStopped / 100, atRiskCollected: m.atRiskCollected / 100, kept: m.keptBySkipOrPause, refunded: m.refundedUnderMerchantRules / 100, toPerson: m.casesToPerson, withoutRule: m.movedWithoutRule, choices: m.choiceBreakdown });
  console.log("Sunita skipped by her own tap:", s.events.some((e) => e.type === "decision_recorded" && e.payload.cycleId === sunita.id && !e.payload.autoplayed));
}

main().catch((e) => { console.error(e); process.exit(1); });
