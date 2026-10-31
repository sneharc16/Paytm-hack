// Plays the whole story on a deployed site through its public API and checks the numbers.
// Usage: pnpm check:live https://your-app.vercel.app
import { randomBytes } from "node:crypto";
import { DEMO_END } from "@/engine/clock";
import { metrics } from "@/engine/metrics";
import { ingest, Session } from "@/engine/session";
import type { PakkaEvent } from "@/engine/types";
import { generateWorld } from "@/engine/world";

async function main() {
  const base = process.argv[2];
  const id = `LIVECHK-${randomBytes(8).toString("hex").toUpperCase()}`;
  const post = (path: string, body: unknown) => fetch(`${base}/api/sessions/${id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.text() }));
  let t = Date.now();
  const jump = await post("clock", { action: "jump", value: DEMO_END });
  console.log(`Jump to 29 Oct 6:00 AM: HTTP ${jump.status} in ${((Date.now() - t) / 1000).toFixed(1)} s ${jump.status !== 200 ? jump.body.slice(0, 200) : ""}`);
  t = Date.now();
  const r = await fetch(`${base}/api/sessions/${id}/events?after=0&epoch=0`).then((x) => x.json()) as { data: { events: PakkaEvent[] } };
  console.log(`Read ${r.data.events.length} events in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const s = new Session(id, generateWorld("2711"));
  ingest(s, r.data.events);
  const m = metrics(s);
  console.log({ unwantedStopped: m.unwantedStopped / 100, atRiskCollected: m.atRiskCollected / 100, kept: m.keptBySkipOrPause, refunded: m.refundedUnderMerchantRules / 100, toPerson: m.casesToPerson, withoutRule: m.movedWithoutRule, choices: m.choiceBreakdown });
}

main().catch((e) => { console.error(e); process.exit(1); });
