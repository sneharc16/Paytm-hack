// pnpm b2b:story: play the business story to the end and print what happened to every invoice.
import { B2B_END } from "@/b2b/clock";
import { verifyChain } from "@/b2b/ledger";
import { b2bMetrics } from "@/b2b/metrics";
import { Treasury } from "@/b2b/treasury";
import { generateBusinessWorld, KAVERI, SAANJH } from "@/b2b/world";
import { inr, timeIST } from "@/lib/format";

const w = generateBusinessWorld("2711");
for (const co of [SAANJH, KAVERI]) {
  const t = new Treasury(w, co);
  t.advance(B2B_END);
  console.log(`\n== ${co}: ${t.events.length} events, chain ${verifyChain(t.events).ok ? "ok" : "BROKEN"}`);
  for (const inv of w.invoices.filter((i) => i.companyId === co)) {
    const s = t.state.invoices.get(inv.id)!;
    const it = s.intentHash ? t.state.intents.get(s.intentHash) : undefined;
    console.log(`${inv.id} ${(inv.tag ?? "").padEnd(13)} ${inr(inv.total).padStart(10)} ${s.status.padEnd(17)} ${it?.tier ?? ""} ${s.paidAt ? timeIST(s.paidAt) : ""} ${s.reasons.join(" | ").slice(0, 110)}`);
  }
  console.log(b2bMetrics(t));
  const refused = t.events.filter((e) => e.type === "command_refused");
  if (refused.length) console.log("refused commands:", refused.map((e) => e.payload));
}
