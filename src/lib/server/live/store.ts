// Where Pakka live keeps each person: their profile and passkeys, the AutoPays they told Pakka about, and their
// event log. Supabase (Postgres) when its keys are set, files under PAKKA_DATA_DIR otherwise, memory for tests.
// Writes are compare-and-set on a version number, so two requests cannot both append to the same log.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PasskeyCredential } from "@/b2b/crypto";
import type { UiLang } from "@/copy/languages";
import type { LiveAutopay, LiveProfile } from "@/engine/live";
import type { PakkaEvent } from "@/engine/types";
import { safeChildPath } from "@/lib/server/security";

export const VALID_LIVE_USER_ID = /^lu_[a-z0-9_]{4,48}$/;
function assertLiveUserId(id: string) {
  if (!VALID_LIVE_USER_ID.test(id)) throw new Error("INVALID_USER_ID");
}

export interface LiveDoc {
  version: number;
  profile: LiveProfile & { uiLang: UiLang; credentials: PasskeyCredential[] };
  autopays: LiveAutopay[];
  events: PakkaEvent[];
}

export class LiveConflict extends Error {}

export interface LiveStore {
  kind: "memory" | "file" | "supabase";
  get(id: string): Promise<LiveDoc | null>;
  /** Save `doc` if the stored version is still `doc.version - 1` (0 for a new person). */
  put(doc: LiveDoc): Promise<void>;
  ids(): Promise<string[]>;
}

export class MemoryLiveStore implements LiveStore {
  kind: LiveStore["kind"] = "memory";
  protected docs = new Map<string, LiveDoc>();
  async get(id: string) { assertLiveUserId(id); const d = this.docs.get(id); return d ? structuredClone(d) : null; }
  async put(doc: LiveDoc) {
    assertLiveUserId(doc.profile.id);
    const cur = this.docs.get(doc.profile.id)?.version ?? 0;
    if (cur !== doc.version - 1) throw new LiveConflict("VERSION_CONFLICT");
    this.docs.set(doc.profile.id, structuredClone(doc));
    this.persist(doc);
  }
  async ids() { return [...this.docs.keys()]; }
  protected persist(doc: LiveDoc) { void doc; }
}

/** One JSON file per person, atomic rename on every write. One process only. */
export class FileLiveStore extends MemoryLiveStore {
  kind: LiveStore["kind"] = "file";
  constructor(private dir: string) {
    super();
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json") && VALID_LIVE_USER_ID.test(f.slice(0, -5))) {
        this.docs.set(f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, f), "utf8")));
      }
    }
  }
  protected persist(doc: LiveDoc) {
    assertLiveUserId(doc.profile.id);
    const file = safeChildPath(this.dir, `${doc.profile.id}.json`), tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc));
    renameSync(tmp, file);
  }
}

export class SupabaseLiveStore implements LiveStore {
  kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}
  async get(id: string) {
    assertLiveUserId(id);
    const { data, error } = await this.db.from("live_people").select("doc").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? (data.doc as LiveDoc) : null;
  }
  async put(doc: LiveDoc) {
    assertLiveUserId(doc.profile.id);
    if (doc.version === 1) {
      const { error } = await this.db.from("live_people").insert({ id: doc.profile.id, version: 1, doc });
      if (error) throw error.code === "23505" ? new LiveConflict(error.message) : new Error(error.message);
      return;
    }
    const { data, error } = await this.db.from("live_people").update({ version: doc.version, doc, updated_at: new Date().toISOString() })
      .eq("id", doc.profile.id).eq("version", doc.version - 1).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new LiveConflict("VERSION_CONFLICT");
  }
  async ids() {
    const { data, error } = await this.db.from("live_people").select("id");
    if (error) throw new Error(error.message);
    return (data as { id: string }[]).map((r) => r.id);
  }
}

let store: LiveStore | null = null;
export function liveStore(): LiveStore {
  if (store) return store;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && process.env.PAKKA_LIVE_STORE !== "file") store = new SupabaseLiveStore(createClient(url, key, { auth: { persistSession: false } }));
  else {
    const dir = path.join(process.env.PAKKA_DATA_DIR ?? path.join(process.cwd(), ".pakka-data"), "people");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    store = new FileLiveStore(dir);
  }
  return store;
}
export function setLiveStoreForTests(s: LiveStore) { store = s; }
