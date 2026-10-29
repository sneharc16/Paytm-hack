// Webhooks: when a company's ledger changes in a way an agent cares about, its registered URL gets a small signed
// notice ("there is work"), so agents need not poll. Signed with the server's Ed25519 webhook key, published at
// /api/v1/live/webhook-key; agents verify with verifyWebhook() from the SDK. Best effort: agents still poll as a
// backstop, and the notice carries no secrets, only sequence numbers and event types.
import { ed25519 } from "@noble/curves/ed25519.js";
import { createHmac } from "node:crypto";
import { toHex } from "@/b2b/crypto";
import type { Treasury } from "@/b2b/treasury";
import type { LedgerEvent } from "@/b2b/types";
import { sha256 } from "@/lib/hash";
import { serverSecret } from "./tokens";

const RELEVANT: Record<string, string[]> = {
  proposer: ["invoice_received", "invoice_released", "intent_expired", "payout_failed", "intent_proposed"],
  compliance: ["attested"],
  risk: ["attested"],
  erp: ["payout_settled", "invoice_held", "invoice_rejected", "payout_failed"],
};

let sk: Uint8Array | null = null;
const key = () => (sk ??= new Uint8Array(createHmac("sha256", serverSecret()).update("PAKKA_B2B_WEBHOOK_KEY_V1").digest()));
export const webhookPublicKey = () => toHex(ed25519.getPublicKey(key()));
export const webhookMessage = (timestamp: string, body: string) => `PAKKA_B2B_WEBHOOK_V1|${timestamp}|${sha256(body)}`;

function allowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (process.env.NODE_ENV !== "production") return true;
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    return !(h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === "[::1]" || h.endsWith(".internal"));
  } catch { return false; }
}

export async function deliverWebhooks(t: Treasury, fresh: LedgerEvent[]): Promise<{ agentId: string; status: number | string }[]> {
  const results: { agentId: string; status: number | string }[] = [];
  for (const a of t.world.agents) {
    if (!a.webhookUrl || t.state.agentStatus.get(a.id) !== "active" || !allowed(a.webhookUrl)) continue;
    const mine = fresh.filter((e) => RELEVANT[a.role]?.includes(e.type));
    if (!mine.length) continue;
    const body = JSON.stringify({ companyId: t.companyId, agentId: a.id, role: a.role, head: t.head, total: t.events.length, events: mine.map((e) => ({ seq: e.seq, type: e.type, at: e.at })) });
    const timestamp = new Date().toISOString();
    const signature = toHex(ed25519.sign(new TextEncoder().encode(webhookMessage(timestamp, body)), key()));
    try {
      const res = await fetch(a.webhookUrl, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(5000), headers: { "content-type": "application/json", "x-pakka-webhook-timestamp": timestamp, "x-pakka-webhook-signature": signature } });
      results.push({ agentId: a.id, status: res.status });
    } catch (e) {
      results.push({ agentId: a.id, status: String((e as Error).name ?? "error") });
    }
  }
  return results;
}
