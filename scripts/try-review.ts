// Try the review loop on one reminder and one live-style question before a full bake.
// Usage: pnpm try:review
import { tick } from "@/engine/agent";
import { DEMO_END } from "@/engine/clock";
import { setWriter, type ReminderFacts } from "@/engine/explain";
import { Session } from "@/engine/session";
import { generateWorld } from "@/engine/world";
import { llmEnabled, provider, runTask } from "@/llm/client";
import { intakeInput, reminderInput } from "@/llm/inputs";

async function main() {
  if (!llmEnabled()) { console.error("No model key in .env.local"); process.exit(1); }
  const world = generateWorld("2711");
  let facts: ReminderFacts | null = null;
  setWriter((f, tpl) => { if (!facts && f.kind === "ask" && f.language === "hinglish") facts = f; return tpl; });
  tick(new Session("TRY", world), DEMO_END);
  const show = (label: string, r: Awaited<ReturnType<typeof runTask>>) => {
    console.log(`\n== ${label}: ${r.ok ? "sent" : "template"} (${r.review?.status ?? r.reason}), ${r.review?.rounds ?? 0} rounds, ${r.review?.calls ?? 0} calls`);
    if (r.review?.reason) console.log("reason:", r.review.reason);
    for (const t of r.review?.trail ?? []) console.log(`round ${t.round}:`, Object.entries(t.verdicts).map(([k, v]) => `${k} ${v}`).join(", "), t.fails.length ? `\n  fails: ${t.fails.map((f) => `${f.criterion} (${f.by}) ${f.fix}`).join(" | ")}` : "");
    if (r.ok) console.log("output:", JSON.stringify(r.output));
    console.log("masked:", JSON.stringify(r.masked));
  };
  console.log(`Provider: ${provider()}`);
  const m = reminderInput(facts!);
  show("L1 reminder", await runTask("reminder", m.input, { useDemoCache: false, mask: m.mask }));
  const q = intakeInput(world, "u_rahul", "Rahul here, mera number 9876543210. ye StadiumPass ka 299 kyun kata?", "hinglish");
  show("L3 reply (12 s budget)", await runTask("intake", q.input, { useDemoCache: false, mask: q.mask, timeoutMs: 12_000, budgetMs: 12_000 }));
}
main().catch((e) => { console.error(e); process.exit(1); });
