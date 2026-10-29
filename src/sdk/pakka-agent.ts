// src/sdk/pakka-agent.ts: the client an AI agent uses to work with Pakka for Business. Works in Node 20+ and
// browsers. The agent's Ed25519 secret key never leaves the agent: every request and every attestation is signed
// locally, and the server holds only the public key and a hash of the API key.
import { ed25519 } from "@noble/curves/ed25519.js";
import { attestMessage, fromHex, requestMessage, toHex } from "@/b2b/crypto";
import type { PaymentIntent, Verdict } from "@/b2b/types";

export interface AgentConfig { baseUrl: string; apiKey: string; secretKey: string }
export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: { code: string; message: string; [k: string]: unknown } };

/** A new agent key pair. Register the public key in the console; keep the secret with the agent. */
export function generateAgentKey() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey: toHex(secretKey), publicKey: toHex(ed25519.getPublicKey(secretKey)) };
}

const nonce = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

export class PakkaAgent {
  private sk: Uint8Array;
  private self: { id: string; role: string } | null = null;
  constructor(private cfg: AgentConfig) {
    const sk = fromHex(cfg.secretKey);
    if (!sk || sk.length !== 32) throw new Error("secretKey must be 32 bytes of hex");
    this.sk = sk;
  }
  get publicKey() { return toHex(ed25519.getPublicKey(this.sk)); }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Ok<T> | Err> {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const url = new URL(path, this.cfg.baseUrl);
    const timestamp = new Date().toISOString(), n = nonce();
    const signature = toHex(ed25519.sign(new TextEncoder().encode(requestMessage({ method, path: url.pathname + url.search, timestamp, nonce: n, body: raw })), this.sk));
    const res = await fetch(url, {
      method, body: method === "GET" ? undefined : raw,
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json", "x-pakka-timestamp": timestamp, "x-pakka-nonce": n, "x-pakka-signature": signature },
    });
    try { return (await res.json()) as Ok<T> | Err; } catch { return { ok: false, error: { code: `HTTP_${res.status}`, message: res.statusText } }; }
  }

  async me() {
    const r = await this.request<{ agent: { id: string; name: string; role: string; modelLabel: string }; sealed: boolean; serverTime: string }>("GET", "/api/v1/agent/me");
    if (r.ok) this.self = r.data.agent;
    return r;
  }
  work<T = WorkItem>() { return this.request<{ role: string; items: T[] }>("GET", "/api/v1/agent/work"); }
  intent(hash: string) { return this.request<IntentView>("GET", `/api/v1/agent/intent?hash=${hash}`); }
  events(after = 0) { return this.request<{ events: unknown[]; head: string; total: number }>("GET", `/api/v1/agent/events?after=${after}`); }
  command<T = Record<string, unknown>>(cmd: unknown) { return this.request<T>("POST", "/api/v1/agent/commands", cmd); }

  submitPurchaseOrder(po: { id: string; vendorId: string; lines: { sku: string; qty: number; rate: number }[] }) { return this.command<{ poId: string }>({ kind: "submit_po", po }); }
  submitGoodsReceipt(grn: { id: string; poId: string; lines: { sku: string; qty: number }[] }) { return this.command<{ grnId: string }>({ kind: "submit_grn", grn }); }
  submitInvoice(invoice: { number: string; vendorId: string; poId: string; date: string; gstin: string; lines: { sku: string; qty: number; rate: number }[]; gst: number; email?: { from: string; subject: string; body: string } }) {
    return this.command<{ invoiceId: string; status: string; flags: string[] }>({ kind: "submit_invoice", invoice });
  }
  propose(invoiceId: string) { return this.command<{ intentHash: string; intent: PaymentIntent }>({ kind: "propose", invoiceId }); }

  /** Sign an intent with this agent's key and send the attestation. */
  async attest(intentHash: string, verdict: Verdict, reasons: string[]) {
    if (!this.self) { const m = await this.me(); if (!m.ok) return m; }
    const signedAt = new Date().toISOString();
    const role = this.self!.role;
    const sig = toHex(ed25519.sign(new TextEncoder().encode(attestMessage({ intentHash, signerId: this.self!.id, role, verdict, reasons, signedAt })), this.sk));
    return this.command<{ status: string }>({ kind: "attest", intentHash, verdict, reasons, signedAt, sig });
  }
}

export interface IntentView { intentHash: string; intent: PaymentIntent; status: string; attestations: unknown[]; needs: string[]; block: { code: string; detail: string } | null; utr: string | null }
export type WorkItem = Record<string, unknown> & { kind: "propose" | "attest" };
