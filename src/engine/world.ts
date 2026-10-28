// src/engine/world.ts: generateWorld(seed), PRD section 10.
// Exact counts are assigned by quota after a seeded shuffle.
import seedrandom from "seedrandom";
import { addMin, ist, isPeak, ms, SESSION_START } from "./clock";
import { MANDATE_COUNTS, MERCHANTS, PLANS, VARIABLE_RANGES } from "./seed/merchants";
import { CITIES, FIRST, LAST } from "./seed/names";
import { AUTHOR_LETTERS, TEMPLATES } from "./seed/reviews";
import type {
  Choice, Cycle, CycleGroup, Gap, ISO, Lang, Mandate, PastExecution, Review, ScriptedOutcome, UsageSignal, User, World,
} from "./types";

type Rng = () => number;

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T,>(rng: Rng, arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
const between = (rng: Rng, a: ISO, b: ISO): ISO => {
  const t = ms(a) + Math.floor(rng() * (ms(b) - ms(a)) / 1000) * 1000;
  return new Date(t).toISOString();
};
const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Quota list: [[value, count], ...] expanded then shuffled. */
function quota<T>(rng: Rng, spec: [T, number][]): T[] {
  return shuffle(rng, spec.flatMap(([v, n]) => Array.from({ length: n }, () => v)));
}

interface Spec {
  merchantId: string;
  planId: string;
  group: CycleGroup;
  userId?: string; // fixed for personas
  sub?: string; // finer group tag
  amount?: number; // paise, overrides plan
  dueAt?: ISO;
  interop?: boolean;
}

export const DEMO = {
  askDue: ist("2026-10-27 23:40"),
  askNotice: ist("2026-10-26 21:10"),
  collectNotice: ist("2026-10-26 21:14"),
  refundAsk: ist("2026-10-26 21:01"),
};

export function generateWorld(seed = "2711"): World {
  const rng: Rng = seedrandom(seed);

  // ---------- users ----------
  const users: User[] = [
    { id: "u_sunita", name: "Sunita Verma", initials: "S. V.", city: "Kanpur", lang: "hi", persona: "sunita" },
    { id: "u_rahul", name: "Rahul Mehra", initials: "R. M.", city: "Pune", lang: "hinglish", persona: "rahul" },
    { id: "u_farhan", name: "Farhan Qureshi", initials: "F. Q.", city: "Lucknow", lang: "hinglish", persona: "farhan" },
    { id: "u_anjali", name: "Anjali Rao", initials: "A. R.", city: "Hyderabad", lang: "en", persona: "anjali" },
  ];
  for (let i = users.length + 1; i <= 6000; i++) {
    const f = pick(rng, FIRST), l = pick(rng, LAST);
    const r = rng();
    const lang: Lang = r < 0.4 ? "hi" : r < 0.8 ? "hinglish" : "en";
    users.push({ id: `u_${pad(i, 4)}`, name: `${f} ${l}`, initials: `${f[0]}. ${l[0]}.`, city: pick(rng, CITIES), lang });
  }

  // ---------- mandate specs ----------
  const personaSpecs: Spec[] = [
    { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "ask", sub: "not_opened", userId: "u_sunita" },
    { merchantId: "m_griha", planId: "p_griha", group: "ordinary", userId: "u_sunita", amount: 1845000, dueAt: ist("2026-11-05 08:00") },
    { merchantId: "m_nivesh", planId: "p_nivesh", group: "ordinary", userId: "u_sunita", amount: 200000, dueAt: ist("2026-11-10 08:00") },
    { merchantId: "m_reelbox", planId: "p_reelbox", group: "ordinary", userId: "u_sunita", dueAt: ist("2026-11-03 07:00"), interop: true },
    { merchantId: "m_stadiumpass", planId: "p_stadiumpass", group: "collect", sub: "retry_success", userId: "u_rahul" },
    { merchantId: "m_padhoai", planId: "p_padhoai_q", group: "refund", sub: "farhan", userId: "u_farhan" },
    { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "ordinary", sub: "anjali", userId: "u_anjali", dueAt: ist("2026-11-25 23:40") },
  ];
  const rest: Spec[] = [];
  const add = (n: number, s: Spec) => { for (let i = 0; i < n; i++) rest.push({ ...s }); };
  add(270, { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "ask", sub: "not_opened" });
  add(47, { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "ask", sub: "unknown" });
  add(92, { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "confirmed" });
  add(21, { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "refund", sub: "auto" });
  add(2, { merchantId: "m_padhoai", planId: "p_padhoai_m", group: "refund", sub: "late" });
  add(3, { merchantId: "m_padhoai", planId: "p_padhoai_q", group: "refund", sub: "quarterly" });
  add(259, { merchantId: "m_stadiumpass", planId: "p_stadiumpass", group: "collect" });

  const used: Record<string, number> = {};
  for (const s of [...personaSpecs, ...rest]) used[s.merchantId] = (used[s.merchantId] ?? 0) + 1;
  for (const m of MERCHANTS) {
    const left = MANDATE_COUNTS[m.id] - (used[m.id] ?? 0);
    const plans = PLANS.filter((p) => p.merchantId === m.id && p.id !== "p_fitghar_lite" && p.id !== "p_padhoai_lite");
    for (let i = 0; i < left; i++) {
      const plan = plans.length > 1 && rng() < 0.2 ? plans[1] : plans[0];
      rest.push({ merchantId: m.id, planId: plan.id, group: "ordinary" });
    }
  }
  shuffle(rng, rest);

  // ---------- assign users: every non-persona user gets 1 to 4 mandates ----------
  const others = users.slice(4);
  const counts = others.map(() => 1);
  let extra = rest.length - others.length;
  while (extra > 0) {
    const i = Math.floor(rng() * others.length);
    if (counts[i] < 4) { counts[i]++; extra--; }
  }
  const slots = shuffle(rng, others.flatMap((u, i) => Array.from({ length: counts[i] }, () => u.id)));
  // Repair: no user holds two mandates from the same merchant.
  const owner = slots.slice();
  const held = new Map<string, Set<string>>();
  const holds = (u: string) => held.get(u) ?? held.set(u, new Set()).get(u)!;
  owner.forEach((u, i) => holds(u).add(rest[i].merchantId + "#" + i));
  const hasMerchant = (u: string, m: string, except: number) =>
    [...holds(u)].some((k) => k.startsWith(m + "#") && k !== m + "#" + except);
  for (let pass = 0; pass < 20; pass++) {
    let fixed = 0;
    for (let i = 0; i < owner.length; i++) {
      if (!hasMerchant(owner[i], rest[i].merchantId, i)) continue;
      for (let tries = 0; tries < 200; tries++) {
        const j = Math.floor(rng() * owner.length);
        const a = owner[i], b = owner[j];
        if (a === b) continue;
        if (hasMerchant(b, rest[i].merchantId, j) || hasMerchant(a, rest[j].merchantId, i)) continue;
        holds(a).delete(rest[i].merchantId + "#" + i); holds(b).delete(rest[j].merchantId + "#" + j);
        owner[i] = b; owner[j] = a;
        holds(b).add(rest[i].merchantId + "#" + i); holds(a).add(rest[j].merchantId + "#" + j);
        fixed++;
        break;
      }
    }
    if (fixed === 0) break;
  }
  const specs: Spec[] = [...personaSpecs, ...rest.map((s, i) => ({ ...s, userId: owner[i] }))];

  // ---------- ask group languages: Hindi 142, Hinglish 131, English 45 ----------
  const userById = new Map(users.map((u) => [u.id, u]));
  const askOthers = specs.filter((s) => s.group === "ask" && s.userId !== "u_sunita");
  const langs = quota<Lang>(rng, [["hi", 141], ["hinglish", 131], ["en", 45]]);
  askOthers.forEach((s, i) => { userById.get(s.userId!)!.lang = langs[i]; });

  // ---------- mandates, cycles, history, usage, scripted ----------
  const mandates: Mandate[] = [];
  const cycles: Cycle[] = [];
  const history: PastExecution[] = [];
  const usage: UsageSignal[] = [];
  const scripted: ScriptedOutcome[] = [];
  const fixtures: World["fixtures"] = { caseCodes: {}, callbackCodes: {}, actionIds: {}, retryOffsetMin: {} };
  const planById = new Map(PLANS.map((p) => [p.id, p]));

  const askAnswers = quota<Choice | "none">(rng, [["keep", 52], ["skip", 139], ["pause", 61], ["cancel", 47], ["none", 18]]);
  let askIdx = 0;
  const collectOutcome = quota<"first" | "retry" | "none">(rng, [["first", 150], ["retry", 33], ["none", 76]]);
  let collectIdx = 0;
  let lateIdx = 0;

  const offPeakTime = (dayIso: string): ISO => {
    // Off-peak minute on a given IST day: night, early morning or afternoon slots.
    for (;;) {
      const slot = pick(rng, [[0, 9 * 60 + 30], [13 * 60 + 5, 16 * 60 + 55], [21 * 60 + 35, 23 * 60 + 55]] as const);
      const m = int(rng, slot[0], slot[1]);
      const t = ist(`${dayIso} ${Math.floor(m / 60)}:${m % 60}`);
      if (!isPeak(new Date(t))) return t;
    }
  };
  const ordinaryWindowStart = ist("2026-10-27 21:35");

  specs.forEach((s, i) => {
    const id = `md_${pad(i + 1, 6)}`;
    const plan = planById.get(s.planId)!;
    const range = VARIABLE_RANGES[s.planId];
    const amount = s.amount ?? (range ? int(rng, range[0] / 100, range[1] / 100) * 10000 : plan.amount);
    const trial = plan.trialAmount !== null;
    const isSunita = s.userId === "u_sunita" && s.group === "ask";
    const trialStartedAt = isSunita ? ist("2026-10-18 19:20")
      : trial && s.merchantId === "m_padhoai" && (s.group === "ask" || s.group === "confirmed") ? between(rng, ist("2026-10-18 08:00"), ist("2026-10-20 22:00"))
      : trial && s.group === "refund" ? between(rng, ist("2026-10-14 08:00"), ist("2026-10-17 22:00"))
      : trial ? between(rng, ist("2026-06-01 08:00"), ist("2026-09-30 22:00")) : null;
    const consent = s.group === "ask" ? s.sub !== "unknown"
      : s.group === "confirmed" || s.group === "refund" || s.group === "collect" ? true
      : s.sub === "anjali" ? false : rng() < 0.3;
    const createdAt = trialStartedAt ?? between(rng, ist("2025-11-01 09:00"), ist("2026-09-20 21:00"));
    mandates.push({
      id, umn: `UMN${pad(int(rng, 0, 999999), 6)}${pad(int(rng, 0, 999999), 6)}`,
      userId: s.userId!, merchantId: s.merchantId, planId: s.planId,
      createdVia: s.interop ? "other_app" : "paytm", visibleViaInterop: !!s.interop,
      irrevocable: s.merchantId === "m_griha",
      amountRule: range ? "max" : "fixed", maxAmount: range ? range[1] * 100 : amount,
      validityEnd: ist("2030-12-31 23:59"), trialStartedAt, usageConsent: consent,
      createdAuth: s.sub === "anjali" ? null : { method: "upi_pin", device: `dev_${pad(int(rng, 0, 99999), 5)}`, at: createdAt },
    });

    const cyc = (seq: number, dueAt: ISO, extra: Partial<Cycle> = {}): Cycle => {
      const c: Cycle = {
        id: `cy_${pad(i + 1, 6)}_${pad(seq, 2)}`, mandateId: id, seq, dueAt,
        noticeAt: addMin(dueAt, -24 * 60 - 30), amount, firstAfterTrial: false,
        confirmedInMerchantAppAt: null, group: s.group, ...extra,
      };
      cycles.push(c);
      return c;
    };

    if (s.group === "ask" || s.group === "confirmed") {
      const c = cyc(1, DEMO.askDue, {
        noticeAt: DEMO.askNotice, firstAfterTrial: true,
        confirmedInMerchantAppAt: s.group === "confirmed" ? between(rng, ist("2026-10-21 09:00"), ist("2026-10-26 20:00")) : null,
      });
      if (consent) usage.push({ mandateId: id, openedSinceTrial: s.group === "confirmed", reportedAt: ist("2026-10-26 20:00") });
      if (s.group === "ask") {
        if (isSunita) {
          // Sunita is played on the phone; this is the autoplay fallback (PRD 25.5).
          scripted.push({ cycleId: c.id, answer: { choice: "skip", at: ist("2026-10-26 21:20") } });
          fixtures.actionIds[`${c.id}|skip`] = "A-5521";
        } else {
          const choice = askAnswers[askIdx++];
          const at = rng() < 0.85 ? between(rng, ist("2026-10-26 21:11"), ist("2026-10-26 22:20"))
            : between(rng, ist("2026-10-27 07:30"), ist("2026-10-27 19:30"));
          scripted.push({ cycleId: c.id, answer: { choice, at } });
        }
      }
    } else if (s.group === "refund") {
      const chargedOn = s.sub === "late" ? "2026-10-23" : s.sub === "quarterly" ? (rng() < 0.5 ? "2026-10-24" : "2026-10-25") : "2026-10-25";
      const c = cyc(1, ist(`${chargedOn} 23:40`), { firstAfterTrial: true });
      history.push({ id: `ex_${c.id}_1`, cycleId: c.id, mandateId: id, at: c.dueAt, amount, result: "success" });
      usage.push({ mandateId: id, openedSinceTrial: false, reportedAt: ist("2026-10-26 20:00") });
      const askAt = s.sub === "farhan" ? ist("2026-10-26 21:02") : addMin(DEMO.refundAsk, int(rng, 0, 4));
      const decision =
        s.sub === "farhan" ? { decision: "decline" as const, at: ist("2026-10-26 21:10"), reason: "Plan terms allow refunds only within 7 days of purchase for quarterly plans." }
        : s.sub === "quarterly" ? { decision: "approve" as const, at: ist("2026-10-26 21:10") }
        : s.sub === "late" ? { decision: "approve" as const, at: ist("2026-10-27 10:15") }
        : undefined;
      scripted.push({ cycleId: c.id, refund: { askAt, ...(decision ? { merchantDecision: decision } : {}) } });
      if (s.sub === "farhan") { fixtures.caseCodes[id] = "PAK-2311"; fixtures.callbackCodes[id] = "4821"; }
      if (s.sub === "late" && lateIdx++ === 0) fixtures.caseCodes[id] = "PAK-2309";
    } else if (s.group === "collect") {
      const prev = cyc(1, ist("2026-09-27 23:40"));
      history.push({ id: `ex_${prev.id}_1`, cycleId: prev.id, mandateId: id, at: prev.dueAt, amount, result: "insufficient_funds" });
      const c = cyc(2, DEMO.askDue, { noticeAt: DEMO.collectNotice });
      usage.push({ mandateId: id, openedSinceTrial: true, reportedAt: ist("2026-10-26 20:00") });
      const kind = s.userId === "u_rahul" ? "retry" : collectOutcome[collectIdx++];
      if (kind === "first") scripted.push({ cycleId: c.id, executionResults: ["success"] });
      else if (kind === "retry") {
        const topupAt = s.userId === "u_rahul" ? ist("2026-10-28 18:05") : between(rng, ist("2026-10-28 07:40"), ist("2026-10-28 20:30"));
        scripted.push({ cycleId: c.id, executionResults: ["insufficient_funds", "success"], topupAt });
        if (s.userId === "u_rahul") fixtures.retryOffsetMin[c.id] = 11;
      } else {
        scripted.push({ cycleId: c.id, executionResults: ["insufficient_funds", "insufficient_funds"], merchantRetryAt: between(rng, ist("2026-10-28 22:00"), ist("2026-10-28 23:30")) });
      }
    } else {
      // Ordinary: one past cycle and the next one, never a first charge, never in a peak window.
      let due = s.dueAt;
      if (!due) {
        const day = new Date(ms(ordinaryWindowStart) + int(rng, 0, 28) * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
        due = offPeakTime(day);
        if (ms(due) < ms(ordinaryWindowStart)) due = addMin(due, 24 * 60);
      }
      const c = cyc(int(rng, 2, 9), due);
      if (s.sub === "anjali") history.push({ id: `ex_${id}_prev`, cycleId: `${c.id}_prev`, mandateId: id, at: ist("2026-10-25 23:40"), amount, result: "success" });
      if (s.sub === "anjali") fixtures.caseCodes[id] = "PAK-2314";
    }
  });

  // ---------- reviews ----------
  const reviews: Review[] = [];
  const brandOf = new Map(MERCHANTS.map((m) => [m.id, m]));
  const fill = (text: string, merchantId: string) => {
    const m = brandOf.get(merchantId)!;
    const amt = PLANS.find((p) => p.merchantId === merchantId)!.amount / 100;
    return text.replaceAll("{amt}", `₹${amt}`).replaceAll("{n}", String(int(rng, 5, 9)))
      .replaceAll("{brand}", m.brand).replaceAll("{legal}", m.legalName);
  };
  const author = () => `${pick(rng, AUTHOR_LETTERS.split(""))}. ${pick(rng, AUTHOR_LETTERS.split(""))}.`;
  const lowT = TEMPLATES.filter((x) => x.low);
  const highT = TEMPLATES.filter((x) => !x.low);
  let rid = 0;
  const push = (merchantId: string, at: ISO, low: boolean, tpl = low ? pick(rng, lowT) : pick(rng, highT), gold = low) => {
    reviews.push({
      id: `rv_${pad(++rid, 5)}`, merchantId, rating: (low ? int(rng, 1, 2) : int(rng, 3, 5)) as Review["rating"],
      text: fill(tpl.text, merchantId), lang: tpl.lang, postedAt: at, author: author(), ...(gold ? { goldGap: tpl.gap } : {}),
    });
  };
  // PadhoAI baseline: 4 low-star reviews a day for 28 days, before the spike window.
  for (let d = 0; d < 28; d++) {
    const dayStart = new Date(ms(ist("2026-09-28 21:00")) + d * 86_400_000).toISOString();
    for (let k = 0; k < 4; k++) push("m_padhoai", between(rng, dayStart, addMin(dayStart, 1020)), true);
  }
  for (let k = 0; k < 142; k++) push("m_padhoai", between(rng, ist("2026-09-27 09:00"), ist("2026-10-26 14:00")), false);
  // The spike: 46 low-star reviews between 2:58 PM and 8:58 PM on 26 Oct.
  const spikeGaps = quota<Gap>(rng, [["consent", 38], ["name", 6], ["ownership", 2]]);
  spikeGaps.forEach((gap, k) => {
    const at = k === 0 ? ist("2026-10-26 20:58") : between(rng, ist("2026-10-26 14:58:30"), ist("2026-10-26 20:57"));
    push("m_padhoai", at, true, pick(rng, lowT.filter((x) => x.gap === gap)));
  });
  for (const m of MERCHANTS.filter((x) => x.id !== "m_padhoai")) {
    for (let k = 0; k < 208; k++) {
      const low = rng() < 0.22;
      push(m.id, between(rng, ist("2026-09-27 09:00"), SESSION_START), low,
        low ? pick(rng, lowT.filter((x) => x.gap === "other" || x.gap === "failed_wanted" || rng() < 0.3)) : undefined);
    }
  }
  reviews.sort((a, b) => ms(a.postedAt) - ms(b.postedAt));

  return { seed, users, merchants: structuredClone(MERCHANTS), plans: PLANS, mandates, cycles, history, usage, reviews, scripted, fixtures };
}
