// PRD 10.2 as data. All merchants are fictional.
import type { Merchant, MerchantSettings, Plan } from "../types";

const off: MerchantSettings = {
  askBeforeFirstCharge: false, shareUsageSignal: false, offerSkip: false, offerDowngradePlanId: null,
  refundAuto: false, refundWindowHours: 0, refundCap: 0, refundDailyLimit: 0, offerCopy: {},
};

type Row = [id: string, brand: string, legal: string, cat: Merchant["category"], count: number, bg: string, fg: string, settings?: Partial<MerchantSettings>];

export const MERCHANT_ROWS: Row[] = [
  ["m_padhoai", "PadhoAI", "Vidyakosh Learning Pvt Ltd", "edtech", 1300, "#FDEBDD", "#A4461A",
    { shareUsageSignal: true, refundAuto: true, refundWindowHours: 48, refundCap: 99900, refundDailyLimit: 5000000 }],
  ["m_stadiumpass", "StadiumPass", "Khelghar Media Pvt Ltd", "sports", 2100, "#E3F1E6", "#2E6B3A", { shareUsageSignal: true }],
  ["m_kathakosh", "KathaKosh", "Shrutika Audio Labs Pvt Ltd", "audio", 900, "#FCE8EF", "#9A2C55"],
  ["m_reelbox", "ReelBox", "Chalchitra Digital Pvt Ltd", "video", 1100, "#E4F4F8", "#17677A"],
  ["m_fitghar", "FitGhar", "Tandurust Wellness Pvt Ltd", "fitness", 600, "#EAF3E1", "#4D6B1F",
    { askBeforeFirstCharge: true, offerSkip: true, offerDowngradePlanId: "p_fitghar_lite", refundAuto: true, refundWindowHours: 72, refundCap: 39900, refundDailyLimit: 2000000 }],
  ["m_dhun", "Dhun Music", "Sargam Streaming Pvt Ltd", "music", 700, "#EFE8F7", "#5B3A8C"],
  ["m_khabar", "Khabar Plus", "Samachar Digital Pvt Ltd", "news", 300, "#F1F1EC", "#55553A"],
  ["m_cloudlocker", "CloudLocker", "Tijori Cloud Services Pvt Ltd", "storage", 250, "#E6EEF9", "#2D5C9E"],
  ["m_rasoibox", "RasoiBox", "Annapurna Kitchens Pvt Ltd", "mealkit", 150, "#FFF0DC", "#8A5300", { offerSkip: true }],
  ["m_gaadicare", "GaadiCare", "Sarathi Auto Services Pvt Ltd", "carcare", 200, "#E8ECEF", "#3D4A55"],
  ["m_nivesh", "Nivesh SIP", "Nivesh Asset Management Ltd", "mutual_fund", 800, "#EFE8F7", "#5B3A8C"],
  ["m_shakti", "Shakti Power", "Shakti Power Distribution Ltd", "electricity", 500, "#FFF4D6", "#8A6100"],
  ["m_griha", "Griha Home Finance", "Griha Home Finance Ltd", "loan", 300, "#E8EDF7", "#2A4A85"],
  ["m_saral", "Saral Insurance", "Saral General Insurance Ltd", "insurance", 200, "#E5F3F1", "#1F6B60"],
];

const KNOWN = new Set(["mutual_fund", "electricity", "loan", "insurance"]);

export const MERCHANTS: Merchant[] = MERCHANT_ROWS.map(([id, brand, legalName, category, , bg, fg, s]) => ({
  id, brand, legalName, brandVerified: true, category, knownObligation: KNOWN.has(category),
  tile: { bg, fg }, settings: { ...off, ...s },
}));

export const MANDATE_COUNTS: Record<string, number> = Object.fromEntries(MERCHANT_ROWS.map((r) => [r[0], r[4]]));

const r = (n: number) => n * 100;
export const PLANS: Plan[] = [
  { id: "p_padhoai_m", merchantId: "m_padhoai", name: "PadhoAI Pro monthly", amount: r(599), interval: "month", trialAmount: r(1), trialDays: 7 },
  { id: "p_padhoai_q", merchantId: "m_padhoai", name: "PadhoAI Pro quarterly", amount: r(1499), interval: "quarter", trialAmount: r(1), trialDays: 7 },
  { id: "p_stadiumpass", merchantId: "m_stadiumpass", name: "StadiumPass monthly", amount: r(299), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_kathakosh", merchantId: "m_kathakosh", name: "KathaKosh quarterly", amount: r(199), interval: "quarter", trialAmount: r(1), trialDays: 7 },
  { id: "p_reelbox", merchantId: "m_reelbox", name: "ReelBox monthly", amount: r(149), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_fitghar", merchantId: "m_fitghar", name: "FitGhar monthly", amount: r(399), interval: "month", trialAmount: r(2), trialDays: 7 },
  { id: "p_fitghar_lite", merchantId: "m_fitghar", name: "FitGhar lite", amount: r(199), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_dhun", merchantId: "m_dhun", name: "Dhun Music monthly", amount: r(99), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_khabar", merchantId: "m_khabar", name: "Khabar Plus monthly", amount: r(49), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_cloudlocker", merchantId: "m_cloudlocker", name: "CloudLocker monthly", amount: r(130), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_rasoibox", merchantId: "m_rasoibox", name: "RasoiBox monthly", amount: r(2499), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_gaadicare", merchantId: "m_gaadicare", name: "GaadiCare monthly", amount: r(799), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_nivesh", merchantId: "m_nivesh", name: "Nivesh SIP", amount: r(2000), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_shakti", merchantId: "m_shakti", name: "Shakti Power bill", amount: r(3000), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_griha", merchantId: "m_griha", name: "Griha Home Finance EMI", amount: r(18450), interval: "month", trialAmount: null, trialDays: null },
  { id: "p_saral", merchantId: "m_saral", name: "Saral Insurance premium", amount: r(5000), interval: "year", trialAmount: null, trialDays: null },
];

/** Range for variable plans, in rupees. Fixed plans use the plan amount. */
export const VARIABLE_RANGES: Record<string, [number, number]> = {
  p_nivesh: [500, 10000], p_shakti: [300, 3000], p_griha: [8000, 40000], p_saral: [1200, 25000],
};
