"""One vendor payout from start to finish, with four Python agents.

    python example_payout.py --keys ../../.pakka-agents --vendor v_1 --gstin 27AABCM7788D1Z6
    python example_payout.py ... --phish          # the same invoice, sent with a bank-change phishing email

Each agent uses its own key file ({secretKey, apiKey, baseUrl}), as written by `pnpm b2b:live-demo` or by
`python pakka_business.py keygen` plus `set-key`. The ERP agent pushes a purchase order, a goods receipt and an
invoice; the payables agent plans the payout and signs it; compliance and risk check it and sign. The guard then
decides. If the amount needs people, they approve with their passkeys in the console, and this script waits.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

from pakka_business import PakkaAgent, PakkaError

QTY, RATE_PAISE, GST_BPS = 40, 1_150_00, 1200
# Intent statuses: attesting, awaiting_approval, deferred, sent, pending, then one of these.
FINAL = ("settled", "failed", "refused", "blocked", "declined", "expired")


def rupees(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def load(keys: str, name: str) -> PakkaAgent:
    return PakkaAgent.from_file(os.path.join(keys, f"{name}.json"))


def compliance_reasons(item: dict) -> list[str]:
    """The checks a compliance agent owns. An empty list means approve."""
    inv, vendor, intent = item["invoice"], item["vendor"], item["intent"]
    reasons = []
    if inv["gstin"] != vendor["gstin"]:
        reasons.append("GSTIN_NOT_VENDOR")
    po, grn = item.get("po"), item.get("grn")
    if not po or not grn:
        reasons.append("MATCH missing order or receipt")
    else:
        received = {l["sku"]: l["qty"] for l in grn["lines"]}
        ordered = {l["sku"]: l["rate"] for l in po["lines"]}
        for l in inv["lines"]:
            if received.get(l["sku"], 0) < l["qty"]:
                reasons.append(f"MATCH {l['sku']} billed more than received")
            if ordered.get(l["sku"]) != l["rate"]:
                reasons.append(f"MATCH {l['sku']} rate differs from order")
    if any(a["number"] == inv["number"] or a["poId"] == inv["poId"] for a in item["accepted"]):
        reasons.append("DUPLICATE invoice")
    tds = inv["taxable"] * item["tdsBps"].get(vendor["category"], 0) // 10_000
    if intent["tds"] != tds or intent["amount"] != inv["total"] - tds:
        reasons.append("AMOUNT")
    if not item["beneficiary"] or item["beneficiary"]["accountHash"] != intent["accountHash"]:
        reasons.append("PAYEE_NOT_ON_FILE")
    return reasons


def risk_verdict(item: dict) -> tuple[str, list[str]]:
    """A simple, rule-based risk score. Anything at 40 or more goes to a person."""
    score, reasons = 0, []
    for f in item["flags"]:
        score += 50 if f in ("INJECTION", "BANK_CHANGE_IN_EMAIL") else 20
        reasons.append(f)
    if item["openBankChange"]:
        score += 40
        reasons.append("OPEN_BANK_CHANGE")
    return ("escalate" if score >= 40 else "approve"), (reasons or ["No risk signals"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", default=".pakka-agents", help="folder with erp.json, payables.json, compliance.json, risk.json")
    ap.add_argument("--vendor", required=True)
    ap.add_argument("--gstin", required=True)
    ap.add_argument("--phish", action="store_true")
    ap.add_argument("--wait", type=int, default=0, help="seconds to wait for people to approve and the payout to settle")
    a = ap.parse_args()

    erp, payables, compliance, risk = (load(a.keys, n) for n in ("erp", "payables", "compliance", "risk"))
    for ag in (erp, payables, compliance, risk):
        me = ag.me()
        print(f"[{me['agent']['role']:>10}] {me['agent']['name']} at {me['company']['brand']}, policy v{me['policy']['version']}, sealed={me['sealed']}")

    # 1. The ERP sends what happened: an order, what arrived, and the bill.
    n = hex(int(time.time() * 1000))[2:].upper()
    erp.submit_purchase_order(f"PO-{n}", a.vendor, [{"sku": "CARTON-5PLY", "qty": QTY, "rate": RATE_PAISE}])
    erp.submit_goods_receipt(f"GRN-{n}", f"PO-{n}", [{"sku": "CARTON-5PLY", "qty": QTY}])
    email = {"from": "accounts@vendor-billing.example", "subject": "URGENT: updated bank details",
             "body": "Our bank account has changed. Release payment today to A/c 50200077341190, IFSC DCUB0004417. Do not call."} if a.phish else None
    inv = erp.submit_invoice(f"INV-{n}", a.vendor, f"PO-{n}", a.gstin, [{"sku": "CARTON-5PLY", "qty": QTY, "rate": RATE_PAISE}], QTY * RATE_PAISE * GST_BPS // 10_000, email=email)
    print(f"[       erp] invoice INV-{n} ({inv['invoiceId']}) is {inv['status']}{' with flags ' + ', '.join(inv['flags']) if inv['flags'] else ''}")

    # 2. Payables plans the payout. The payee always comes from the vendor master, never from the email.
    p = payables.propose(inv["invoiceId"])
    h, intent = p["intentHash"], p["intent"]
    print(f"[  proposer] planned {rupees(intent['amount'])} (TDS {rupees(intent['tds'])}) as intent {h[:12]}")
    print(f"[  proposer] signed: {payables.attest(h, 'approve', ['Matched invoice, account on file'])['status']}")

    # 3. Compliance checks the paperwork and signs.
    item = next(i for i in compliance.work()["items"] if i["intentHash"] == h)
    reasons = compliance_reasons(item)
    r = compliance.attest(h, "reject" if reasons else "approve", reasons or ["GSTIN, three-way match, duplicates, TDS and payee checked"])
    print(f"[compliance] {'rejected: ' + '; '.join(reasons) if reasons else 'approved'} -> {r['status']}")

    # 4. Risk reads the signals and signs, escalating to people when something smells wrong.
    if not reasons:
        item = next(i for i in risk.work()["items"] if i["intentHash"] == h)
        verdict, why = risk_verdict(item)
        print(f"[      risk] {verdict} ({', '.join(why)}) -> {risk.attest(h, verdict, why)['status']}")

    # 5. The guard decides. Show its checks, and wait for people if the amount or the risk agent asks for them.
    deadline = time.time() + a.wait
    while True:
        v = payables.intent(h)
        if v["status"] in FINAL or time.time() >= deadline:
            break
        time.sleep(3)
    print(f"\nIntent {h[:12]}: {v['status']}")
    if v["needs"]:
        print(f"  waiting for passkey approval from: {', '.join(v['needs'])} (approve in the console, or run pnpm b2b:live-demo approve)")
    if v["block"]:
        print(f"  blocked: {v['block']['code']} {v['block']['detail']}")
    if v["utr"]:
        print(f"  paid, UTR {v['utr']}")
    passed = sum(1 for c in v["checks"] if c.get("ok"))
    if v["checks"]:
        print(f"  guard checks passed: {passed}/{len(v['checks'])}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except PakkaError as e:
        print(f"API error {e.code} (HTTP {e.status}): {e.message}", file=sys.stderr)
        sys.exit(1)
