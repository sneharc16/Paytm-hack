// Where live business ledgers are kept. Supabase (Postgres) when its keys are set, so it works on serverless
// hosts; otherwise files under PAKKA_DATA_DIR (default .pakka-data) for a laptop; memory for tests.
// Ledgers are append-only: an append succeeds only if the ledger still ends where the writer expects.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LedgerEvent } from "@/b2b/types";
import { safeChildPath } from "@/lib/server/security";

export const VALID_ORG_ID = /^co_[a-z0-9_]{3,48}$/;
function assertOrgId(orgId: string) {
  if (!VALID_ORG_ID.test(orgId)) throw new Error("INVALID_ORG_ID");
}

export class ConflictError extends Error {}

export interface B2BStore {
  kind: "memory" | "file" | "supabase";
  events(orgId: string): Promise<LedgerEvent[]>;
  /** Append events numbered after `afterSeq`. Throws ConflictError if someone else appended first. */
  append(orgId: string, afterSeq: number, events: LedgerEvent[]): Promise<void>;
  orgIds(): Promise<string[]>;
  /** Record a one-time value (request nonce, used challenge). False if it was already used. */
  useOnce(key: string, expiresAt: string): Promise<boolean>;
  /** Whether a one-time value has been recorded (and not expired). */
  seen(key: string): Promise<boolean>;
}

export class MemoryStore implements B2BStore {
  kind: B2BStore["kind"] = "memory";
  protected logs = new Map<string, LedgerEvent[]>();
  protected once = new Map<string, string>();
  async events(orgId: string) { assertOrgId(orgId); return structuredClone(this.logs.get(orgId) ?? []); }
  async append(orgId: string, afterSeq: number, events: LedgerEvent[]) {
    assertOrgId(orgId);
    const log = this.logs.get(orgId) ?? [];
    if ((log.at(-1)?.seq ?? 0) !== afterSeq) throw new ConflictError("SEQ_CONFLICT");
    this.logs.set(orgId, [...log, ...structuredClone(events)]);
    this.persist(orgId);
  }
  async orgIds() { return [...this.logs.keys()]; }
  async useOnce(key: string, expiresAt: string) {
    if (!key || key.length > 256) return false;
    const now = new Date().toISOString();
    for (const [k, exp] of this.once) if (exp < now) this.once.delete(k);
    if (this.once.has(key)) return false;
    if (this.once.size >= 16_384) {
      const oldest = this.once.keys().next().value;
      if (oldest !== undefined) this.once.delete(oldest);
    }
    this.once.set(key, expiresAt);
    this.persistOnce();
    return true;
  }
  async seen(key: string) { const exp = this.once.get(key); return !!exp && exp >= new Date().toISOString(); }
  protected persist(orgId: string) { void orgId; }
  protected persistOnce() {}
}

/** One JSON file per company plus one for one-time values; atomic rename on every write. One process only. */
export class FileStore extends MemoryStore {
  kind: B2BStore["kind"] = "file";
  constructor(private dir: string) {
    super();
    mkdirSync(path.join(dir, "orgs"), { recursive: true });
    for (const f of readdirSync(path.join(dir, "orgs"))) {
      if (f.endsWith(".json") && VALID_ORG_ID.test(f.slice(0, -5))) {
        this.logs.set(f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, "orgs", f), "utf8")));
      }
    }
    const once = path.join(dir, "once.json");
    if (existsSync(once)) this.once = new Map(Object.entries(JSON.parse(readFileSync(once, "utf8"))));
  }
  private write(file: string, data: unknown) {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }
  protected persist(orgId: string) {
    assertOrgId(orgId);
    this.write(safeChildPath(path.join(this.dir, "orgs"), `${orgId}.json`), this.logs.get(orgId));
  }
  protected persistOnce() { this.write(safeChildPath(this.dir, "once.json"), Object.fromEntries(this.once)); }
}

type Row = { seq: number; at: string; company_id: string; type: string; actor: LedgerEvent["actor"]; rule_id: string | null; payload: LedgerEvent["payload"]; prev: string; hash: string };
const PAGE = 1000;

export class SupabaseStore implements B2BStore {
  kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}
  async events(orgId: string) {
    assertOrgId(orgId);
    const out: LedgerEvent[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db.from("b2b_events").select("seq,at,company_id,type,actor,rule_id,payload,prev,hash").eq("org_id", orgId).order("seq").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data as Row[]) out.push({ seq: r.seq, at: new Date(r.at).toISOString(), companyId: r.company_id, type: r.type, actor: r.actor, ...(r.rule_id ? { ruleId: r.rule_id } : {}), payload: r.payload, prev: r.prev, hash: r.hash });
      if ((data as Row[]).length < PAGE) return out;
    }
  }
  async append(orgId: string, afterSeq: number, events: LedgerEvent[]) {
    assertOrgId(orgId);
    const { error } = await this.db.rpc("b2b_append", { p_org: orgId, p_after: afterSeq, p_events: events });
    if (error) throw error.message.includes("SEQ_CONFLICT") ? new ConflictError(error.message) : new Error(error.message);
  }
  async orgIds() {
    const { data, error } = await this.db.from("b2b_orgs").select("id");
    if (error) throw new Error(error.message);
    return (data as { id: string }[]).map((r) => r.id);
  }
  async seen(key: string) {
    const { data, error } = await this.db.from("b2b_once").select("key").eq("key", key).gte("expires_at", new Date().toISOString()).maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  }
  async useOnce(key: string, expiresAt: string) {
    await this.db.from("b2b_once").delete().lt("expires_at", new Date().toISOString());
    const { error } = await this.db.from("b2b_once").insert({ key, expires_at: expiresAt });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(error.message);
  }
}

let store: B2BStore | null = null;
export function b2bStore(): B2BStore {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && process.env.PAKKA_B2B_STORE !== "file") store = new SupabaseStore(createClient(url, key, { auth: { persistSession: false } }));
  else store = new FileStore(process.env.PAKKA_DATA_DIR ?? path.join(process.cwd(), ".pakka-data"));
  return store;
}
export function setB2BStoreForTests(s: B2BStore) { store = s; }
