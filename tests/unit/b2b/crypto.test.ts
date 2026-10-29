import { describe, expect, it } from "vitest";
import { approveMessage, canonical, verifySig } from "@/b2b/crypto";
import { gstinCheckChar, isGstin, makeGstin } from "@/b2b/gstin";
import { intentHash } from "@/b2b/intent";
import { approve, publicKeyOf } from "@/b2b/keys";
import { defaultPolicy, diffPolicy, isLoosening, tierFor } from "@/b2b/policy";

describe("canonical encoding", () => {
  it("sorts keys and drops undefined", () => expect(canonical({ b: 1, a: [2, { d: true, c: "x" }], z: undefined })).toBe('{"a":[2,{"c":"x","d":true}],"b":1}'));
  it("refuses floats and huge numbers in signed data", () => {
    expect(() => canonical({ amount: 10.5 })).toThrow();
    expect(() => canonical({ amount: 2 ** 60 })).toThrow();
  });
});

describe("signatures", () => {
  const pk = publicKeyOf("2711", "p_arjun");
  const a = approve("2711", "co_saanjh", "p_arjun", "checker", "ab".repeat(32), "2026-10-26T06:00:00.000Z");
  it("verify for the signer and the exact message", () => expect(verifySig(pk, approveMessage(a), a.sig)).toBe(true));
  it("fail for a changed message, another key or garbage, without throwing", () => {
    expect(verifySig(pk, approveMessage({ ...a, role: "cfo" }), a.sig)).toBe(false);
    expect(verifySig(publicKeyOf("2711", "p_kabir"), approveMessage(a), a.sig)).toBe(false);
    expect(verifySig(pk, approveMessage(a), "zz")).toBe(false);
    expect(verifySig("nothex", approveMessage(a), a.sig)).toBe(false);
  });
  it("are deterministic", () => expect(approve("2711", "co_saanjh", "p_arjun", "checker", "ab".repeat(32), "2026-10-26T06:00:00.000Z").sig).toBe(a.sig));
});

describe("GSTIN", () => {
  it("catches every single-character change", () => {
    const g = makeGstin("27", "ABCCS1234K");
    expect(isGstin(g)).toBe(true);
    for (let i = 0; i < 15; i++) {
      const c = g[i] === "9" ? "8" : g[i] === "Z" ? "Y" : /\d/.test(g[i]) ? String(Number(g[i]) + 1) : "Q";
      const t = g.slice(0, i) + c + g.slice(i + 1);
      if (t !== g) expect(isGstin(t), t).toBe(false);
    }
  });
  it("computes the check character", () => expect(gstinCheckChar("27ABCCS1234K1Z")).toMatch(/^[0-9A-Z]$/));
});

describe("policy", () => {
  const p = defaultPolicy("co_saanjh", ["a".repeat(64)]);
  it("classifies loosening by direction, not by what the proposer says", () => {
    expect(isLoosening(diffPolicy(p, { ...p, dailyLimit: p.dailyLimit + 1 }))).toBe(true);
    expect(isLoosening(diffPolicy(p, { ...p, dailyLimit: p.dailyLimit - 1, coolingHoursNew: 48 }))).toBe(false);
    expect(isLoosening(diffPolicy(p, { ...p, coolingHoursChanged: 1 }))).toBe(true);
    expect(isLoosening(diffPolicy(p, { ...p, allowedModels: [...p.allowedModels, "b".repeat(64)] }))).toBe(true);
  });
  it("tiers by the 24 hour vendor total", () => {
    expect(tierFor(p, 49_999_00, false)).toBe("agents");
    expect(tierFor(p, 50_000_00, false)).toBe("checker");
    expect(tierFor(p, 10_00, true)).toBe("checker");
    expect(tierFor(p, 5_00_000_00, false)).toBe("checker_cfo");
  });
  it("hashes intents stably", () => {
    const i = { v: 1, domain: "PAKKA_B2B_INTENT_V1", intentId: "pi_1_x", companyId: "co_saanjh", vendorId: "v_x", beneficiaryId: "b", accountHash: "a".repeat(64), amount: 100, tds: 0, invoiceIds: ["i"], rail: "IMPS", nonce: 1, policyVersion: 1, policyHash: "b".repeat(64), modelHash: "c".repeat(64), preparedFor: "p_neha", createdAt: "2026-10-26T00:00:00.000Z", expiresAt: "2026-10-26T01:00:00.000Z" } as const;
    expect(intentHash({ ...i, invoiceIds: ["i"] })).toBe(intentHash({ ...i, invoiceIds: ["i"] }));
    expect(intentHash({ ...i, invoiceIds: ["i"], amount: 101 })).not.toBe(intentHash({ ...i, invoiceIds: ["i"] }));
  });
});
