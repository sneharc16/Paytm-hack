"""Pakka for Business: the Python client for AI agents.

An agent plans and checks vendor payouts through this API. It can never move money itself: a payout leaves only
when the treasury guard has verified three agent signatures, the passkey signatures of the people the amount
needs, and every policy check.

The agent's Ed25519 secret key never leaves the agent. Every request and every attestation is signed here; the
server keeps only the public key and a hash of the API key.

Needs Python 3.9+, `cryptography` and `requests`:

    pip install cryptography requests

Make a key pair (paste the public key into the console when you register the agent):

    python pakka_business.py keygen payables

Then, with the API key the console showed you:

    from pakka_business import PakkaAgent
    agent = PakkaAgent(base_url="http://localhost:3000", api_key="pk_...", secret_key="<64 hex>")
    print(agent.me())
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from typing import Any, Iterable, Optional
from urllib.parse import urlsplit

import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

__all__ = ["PakkaAgent", "PakkaError", "generate_agent_key", "verify_webhook", "request_message", "attest_message", "iso_now"]
__version__ = "1.0.0"

# The exact strings each party signs. They must match src/b2b/crypto.ts byte for byte.
REQUEST_DOMAIN = "PAKKA_B2B_REQUEST_V1"
ATTEST_DOMAIN = "PAKKA_B2B_ATTEST_V1"
WEBHOOK_DOMAIN = "PAKKA_B2B_WEBHOOK_V1"
MAX_SKEW_SECONDS = 5 * 60


def sha256_hex(data: str | bytes) -> str:
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def iso_now() -> str:
    """UTC time the way the server writes it: 2026-10-30T12:34:56.789Z."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request_message(method: str, path: str, timestamp: str, nonce: str, body: str) -> str:
    """What the agent signs for every HTTP request. `path` includes the query string."""
    return f"{REQUEST_DOMAIN}|{method.upper()}|{path}|{timestamp}|{nonce}|{sha256_hex(body)}"


def attest_message(intent_hash: str, signer_id: str, role: str, verdict: str, reasons: Iterable[str], signed_at: str) -> str:
    """What the agent signs when it approves, escalates or rejects a payout intent."""
    return f"{ATTEST_DOMAIN}|{intent_hash}|{signer_id}|{role}|{verdict}|{','.join(reasons)}|{signed_at}"


def generate_agent_key() -> dict[str, str]:
    """A new Ed25519 key pair as hex. Register `public_key` in the console; keep `secret_key` with the agent."""
    sk = Ed25519PrivateKey.generate()
    raw_sk = sk.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    raw_pk = sk.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return {"secret_key": raw_sk.hex(), "public_key": raw_pk.hex()}


def verify_webhook(raw_body: bytes | str, timestamp: Optional[str], signature: Optional[str], server_public_key: str, max_skew_seconds: int = MAX_SKEW_SECONDS) -> bool:
    """Check a webhook from Pakka: the server's Ed25519 signature over time and body, and that it is fresh.

    Pass the body exactly as received (before any JSON parsing) and the `x-pakka-webhook-timestamp` and
    `x-pakka-webhook-signature` headers. Get `server_public_key` once from GET /api/v1/live/webhook-key.
    """
    if not timestamp or not signature:
        return False
    try:
        sent = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if abs((datetime.now(timezone.utc) - sent).total_seconds()) > max_skew_seconds:
            return False
        pk = Ed25519PublicKey.from_public_bytes(bytes.fromhex(server_public_key))
        pk.verify(bytes.fromhex(signature), f"{WEBHOOK_DOMAIN}|{timestamp}|{sha256_hex(raw_body)}".encode("utf-8"))
        return True
    except (ValueError, InvalidSignature):
        return False


class PakkaError(Exception):
    """The API said no. `code` is stable (BAD_API_KEY, STALE_REQUEST, ALREADY_ATTESTED, ...); `details` has the rest."""

    def __init__(self, code: str, message: str = "", status: int = 0, details: Optional[dict] = None):
        super().__init__(f"{code}: {message}" if message and message != code else code)
        self.code, self.message, self.status, self.details = code, message, status, details or {}


class PakkaAgent:
    """One agent: its API key, its secret key and the server it talks to."""

    def __init__(self, base_url: str, api_key: str, secret_key: str, timeout: float = 20.0, session: Optional[requests.Session] = None):
        try:
            raw = bytes.fromhex(secret_key)
        except ValueError:
            raw = b""
        if len(raw) != 32:
            raise ValueError("secret_key must be 32 bytes of hex (64 characters)")
        self._sk = Ed25519PrivateKey.from_private_bytes(raw)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.http = session or requests.Session()
        self._self: Optional[dict] = None

    @classmethod
    def from_env(cls) -> "PakkaAgent":
        """PAKKA_BASE_URL, PAKKA_API_KEY and PAKKA_SECRET_KEY from the environment."""
        return cls(os.environ.get("PAKKA_BASE_URL", "http://localhost:3000"), os.environ["PAKKA_API_KEY"], os.environ["PAKKA_SECRET_KEY"])

    @classmethod
    def from_file(cls, path: str) -> "PakkaAgent":
        """A key file written by `pnpm agents keygen` / `pnpm b2b:live-demo` ({secretKey, apiKey, baseUrl})."""
        with open(path, encoding="utf-8") as f:
            s = json.load(f)
        return cls(s.get("baseUrl", "http://localhost:3000"), s["apiKey"], s["secretKey"])

    @property
    def public_key(self) -> str:
        return self._sk.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()

    # ---------------- transport ----------------
    def raw_request(self, method: str, path: str, body: Any = None) -> tuple[int, dict]:
        """Sign and send one request. Returns (HTTP status, parsed JSON) without raising on API errors."""
        method = method.upper()
        raw = "" if body is None else json.dumps(body, separators=(",", ":"))
        url = self.base_url + path
        parts = urlsplit(url)
        signed_path = parts.path + (f"?{parts.query}" if parts.query else "")
        timestamp, nonce = iso_now(), secrets.token_hex(16)
        signature = self._sk.sign(request_message(method, signed_path, timestamp, nonce, raw).encode("utf-8")).hex()
        headers = {
            "authorization": f"Bearer {self.api_key}",
            "content-type": "application/json",
            "x-pakka-timestamp": timestamp,
            "x-pakka-nonce": nonce,
            "x-pakka-signature": signature,
        }
        res = self.http.request(method, url, data=raw.encode("utf-8") if method != "GET" else None, headers=headers, timeout=self.timeout, allow_redirects=False)
        try:
            return res.status_code, res.json()
        except ValueError:
            return res.status_code, {"ok": False, "error": {"code": f"HTTP_{res.status_code}", "message": res.reason}}

    def request(self, method: str, path: str, body: Any = None) -> dict:
        """Sign and send one request; return `data`, or raise PakkaError with the API's code."""
        status, j = self.raw_request(method, path, body)
        if j.get("ok"):
            return j.get("data", {})
        err = j.get("error") or {}
        raise PakkaError(err.get("code", f"HTTP_{status}"), err.get("message", ""), status, {k: v for k, v in err.items() if k not in ("code", "message")})

    # ---------------- reading ----------------
    def me(self) -> dict:
        """The agent, its company, the policy version and whether setup is sealed."""
        data = self.request("GET", "/api/v1/agent/me")
        self._self = data["agent"]
        return data

    def work(self) -> dict:
        """What this agent should do next: {role, items: [...]}, each item with the context it needs."""
        return self.request("GET", "/api/v1/agent/work")

    def intent(self, intent_hash: str) -> dict:
        """An intent's status, signatures, approvals, block reason, UTR and the guard's checks."""
        return self.request("GET", f"/api/v1/agent/intent?hash={intent_hash}")

    def events(self, after: int = 0) -> dict:
        """The company's ledger from a sequence number: {events, head, total}."""
        return self.request("GET", f"/api/v1/agent/events?after={int(after)}")

    # ---------------- writing ----------------
    def command(self, cmd: dict) -> dict:
        return self.request("POST", "/api/v1/agent/commands", cmd)

    def submit_purchase_order(self, po_id: str, vendor_id: str, lines: list[dict]) -> dict:
        """lines: [{"sku", "qty", "rate"}]; rate is integer paise per unit."""
        return self.command({"kind": "submit_po", "po": {"id": po_id, "vendorId": vendor_id, "lines": lines}})

    def submit_goods_receipt(self, grn_id: str, po_id: str, lines: list[dict]) -> dict:
        """lines: [{"sku", "qty"}] actually received."""
        return self.command({"kind": "submit_grn", "grn": {"id": grn_id, "poId": po_id, "lines": lines}})

    def submit_invoice(self, number: str, vendor_id: str, po_id: str, gstin: str, lines: list[dict], gst: int, date: Optional[str] = None, email: Optional[dict] = None) -> dict:
        """An invoice as received. `gst` is in paise. `email` ({from, subject, body}) is scanned, never obeyed."""
        inv: dict[str, Any] = {"number": number, "vendorId": vendor_id, "poId": po_id, "date": date or iso_now(), "gstin": gstin, "lines": lines, "gst": gst}
        if email:
            inv["email"] = email
        return self.command({"kind": "submit_invoice", "invoice": inv})

    def propose(self, invoice_id: str) -> dict:
        """Plan a payout for a matched invoice (proposer only). Returns {intentHash, intent}."""
        return self.command({"kind": "propose", "invoiceId": invoice_id})

    def attest(self, intent_hash: str, verdict: str, reasons: list[str]) -> dict:
        """Sign an intent with this agent's key: verdict is "approve", "escalate" or "reject"."""
        if verdict not in ("approve", "escalate", "reject"):
            raise ValueError("verdict must be approve, escalate or reject")
        if not reasons:
            raise ValueError("give at least one reason")
        if self._self is None:
            self.me()
        signed_at = iso_now()
        msg = attest_message(intent_hash, self._self["id"], self._self["role"], verdict, reasons, signed_at)
        sig = self._sk.sign(msg.encode("utf-8")).hex()
        return self.command({"kind": "attest", "intentHash": intent_hash, "verdict": verdict, "reasons": reasons, "signedAt": signed_at, "sig": sig})


def _main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "keygen":
        name = argv[2] if len(argv) > 2 else "agent"
        k = generate_agent_key()
        path = f"{name}.key.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"name": name, "secretKey": k["secret_key"], "publicKey": k["public_key"]}, f, indent=2)
        print(f"Saved {path} (keep it secret; it never needs to leave this machine).")
        print("Public key, paste it into People and agents > Register an agent:")
        print(k["public_key"])
        return 0
    if len(argv) >= 4 and argv[1] == "set-key":
        path, api_key = argv[2], argv[3]
        base = argv[4] if len(argv) > 4 else "http://localhost:3000"
        with open(path, encoding="utf-8") as f:
            s = json.load(f)
        s.update(apiKey=api_key, baseUrl=base)
        fd = os.open(path, os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=2)
        try:
            me = PakkaAgent.from_file(path).me()
            print(f"Connected as {me['agent']['name']} ({me['agent']['role']}) at {me['company']['brand']}.")
        except PakkaError as e:
            print(f"Saved, but the API said {e.code}.")
        return 0
    print("python pakka_business.py keygen <name>               make a key pair")
    print("python pakka_business.py set-key <file> <apiKey> [url]  save the API key the console showed and test it")
    return 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
