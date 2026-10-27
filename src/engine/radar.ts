// src/engine/radar.ts: Review Radar (PRD 15). Runs as a batch at :58 past each hour.
import { inr } from "@/lib/format";
import { addMin, ms } from "./clock";
import { run } from "./gateway";
import type { Session } from "./session";
import type { Gap, ISO, Review } from "./types";

const MENTIONS = /(autopay|auto pay|trial|ट्रायल|₹|rupay|refund|wapas|cancel|band kar|बंद|पैसा|paisa|kat|कट|deduct|charged|debit|message|msg|sms)/i;

export function mentionsAutopay(r: Review, brand: string, legal: string) {
  return MENTIONS.test(r.text) || r.text.includes(brand) || r.text.includes(legal);
}

/** Tag from the cache. With no model configured the cache holds the hand-checked seed labels. */
type Tagger = (r: Review) => { gap: Gap; confidence: number; evidence: string; modelVersion: string };
let tagger: Tagger = (r) => ({ gap: r.goldGap ?? "other", confidence: 1, evidence: r.text.slice(0, 120), modelVersion: "seed-labels" });
export function setTagger(t: Tagger) { tagger = t; }
/** The current tag for a review: model output from the cache when there is one, else the seed label. */
export function tagReview(r: Review) { return tagger(r); }

type AlertWriter = (metrics: Record<string, number | string>, tpl: { headline: string; detail: string; modelVersion: string }) => { headline: string; detail: string; modelVersion: string };
let alertWriter: AlertWriter = (_m, tpl) => tpl;
/** Plug in the L6 model (demo cache or live). Numbers must come only from the metrics. */
export function setAlertWriter(fn: AlertWriter) { alertWriter = fn; }

export interface RadarRow { merchantId: string; count6h: number; baseline6h: number; threshold: number; gaps: Record<Gap, number>; spike: boolean }

export function radarSnapshot(s: Session, at: ISO): RadarRow[] {
  const winStart = ms(addMin(at, -360));
  const baseStart = winStart - 28 * 86_400_000;
  return s.world.merchants.map((m) => {
    const low = s.world.reviews.filter((r) => r.merchantId === m.id && r.rating <= 2 && ms(r.postedAt) <= ms(at) && mentionsAutopay(r, m.brand, m.legalName));
    const win = low.filter((r) => ms(r.postedAt) > winStart);
    const base = low.filter((r) => ms(r.postedAt) > baseStart && ms(r.postedAt) <= winStart);
    const baseline6h = (base.length / 28) * (6 / 24);
    const threshold = Math.max(10, 5 * baseline6h);
    const gaps = { consent: 0, name: 0, ownership: 0, failed_wanted: 0, other: 0 } as Record<Gap, number>;
    for (const r of win) gaps[tagger(r).gap]++;
    const spike = win.length >= threshold && (gaps.consent + gaps.name) / Math.max(1, win.length) >= 0.6;
    return { merchantId: m.id, count6h: win.length, baseline6h, threshold, gaps, spike };
  });
}

export function runRadar(s: Session, at: ISO) {
  for (const row of radarSnapshot(s, at)) {
    if (!row.spike || s.state.openIncidentFor(row.merchantId)) continue;
    const m = s.idx.merchant.get(row.merchantId)!;
    const winStart = ms(addMin(at, -360));
    for (const r of s.world.reviews) {
      if (r.merchantId !== m.id || r.rating > 2 || ms(r.postedAt) <= winStart || ms(r.postedAt) > ms(at) || s.state.taggedReviews.has(r.id)) continue;
      if (!mentionsAutopay(r, m.brand, m.legalName)) continue;
      const tag = tagger(r);
      s.emit({ actor: "ai", simAt: at, type: "review_tagged", modelVersion: tag.modelVersion, subjectType: "merchant", subjectId: m.id, payload: { reviewId: r.id, gap: tag.gap, confidence: tag.confidence, evidence: tag.evidence } });
    }
    const incidentId = `INC-${String(7 + s.state.incidents.size).padStart(2, "0")}`;
    const metrics = { count: row.count6h, consent: row.gaps.consent, name: row.gaps.name, ownership: row.gaps.ownership, baseline6h: Math.round(row.baseline6h * 100) / 100, threshold: row.threshold };
    run(s, at, { type: "openIncident", ruleId: "INCIDENT_V1", actor: "ai", targetId: m.id, discriminator: incidentId, params: { merchantId: m.id, incidentId, metrics } });
    const plan = s.world.plans.find((p) => p.merchantId === m.id)!;
    // L6 merchant alert: numbers only from the metrics, no adjectives about the merchant.
    const alertInput = { brand: m.brand, count: row.count6h, consent: row.gaps.consent, name: row.gaps.name, ownership: row.gaps.ownership, trial_amount: inr(plan.trialAmount ?? 0), amount: inr(plan.amount) };
    const alert = alertWriter(alertInput, {
      modelVersion: "template",
      headline: `${row.count6h} reviews in the last 6 hours mention your ${inr(plan.trialAmount ?? 0)} trial and AutoPay.`,
      detail: `Only you and Paytm's merchant team can see this. ${row.gaps.consent} of them say they didn't know a ${inr(plan.amount)} charge would follow.`,
    });
    run(s, at, {
      type: "alertMerchant", ruleId: "INCIDENT_V1", actor: "ai", targetId: m.id, discriminator: incidentId,
      params: { merchantId: m.id, incidentId, ...alert },
    });
  }
}
