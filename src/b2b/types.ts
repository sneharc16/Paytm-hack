// src/b2b/types.ts: Pakka for Business. An AI accounts-payable team that can propose vendor payouts but can
// never release one: every rupee leaves only through guard.ts, and only with a receipt that the guard can check
// without trusting the agents, the host they run on, or the invoice they read. Pure data types, no logic.
export type Paise = number; // integer
export type ISO = string; // UTC

export type Rail = "IMPS" | "NEFT" | "RTGS";
export type VendorCategory = "goods" | "logistics" | "services" | "rent";

export interface Company {
  id: string; legalName: string; brand: string; gstin: string; pan: string; city: string;
  accountNo: string; ifsc: string; openingBalance: Paise; tile: { bg: string; fg: string };
}

export interface Vendor {
  id: string; companyId: string; legalName: string; brand: string; gstin: string; pan: string; category: VendorCategory;
  msme: boolean; udyam?: string; phoneOnFile: string; email: string; termsDays: number;
  /** Paise of past invoices, for the risk agent's "is this amount normal" check. */
  history: Paise[];
}

export interface Beneficiary {
  id: string; companyId: string; vendorId: string; accountNo: string; ifsc: string; nameAtBank: string; accountHash: string;
  addedAt: ISO; addedVia: "onboarding" | "change_request"; approvedBy?: string;
}

export interface Line { sku: string; qty: number; rate: Paise }
export interface PurchaseOrder { id: string; companyId: string; vendorId: string; lines: Line[]; createdAt: ISO }
export interface GoodsReceipt { id: string; companyId: string; poId: string; lines: { sku: string; qty: number }[]; receivedAt: ISO }

export interface InvoiceEmail { from: string; subject: string; body: string }
export interface Invoice {
  id: string; companyId: string; vendorId: string; number: string; date: ISO; poId: string;
  lines: Line[]; taxable: Paise; gst: Paise; total: Paise; gstin: string;
  arrivesAt: ISO; email: InvoiceEmail;
  /** Story tag so tests and the demo can find the scripted invoices. */
  tag?: string;
}

export type PersonRole = "maker" | "checker" | "cfo" | "governor";
export interface Person { id: string; companyId: string; name: string; roles: PersonRole[]; publicKey: string; title: string }

export type AgentRole = "proposer" | "compliance" | "risk";
export interface Agent { id: string; companyId: string; role: AgentRole; name: string; publicKey: string; modelHash: string; modelLabel: string }

/** Bank directory the penny-drop simulator reads: who really owns an account. */
export interface BankAccountRecord { accountNo: string; ifsc: string; holder: string }

export type BankScript = "success" | "pending_then_success" | "fail_technical" | "timeout_then_success";

export interface BusinessWorld {
  seed: string;
  companies: Company[];
  vendors: Vendor[];
  beneficiaries: Beneficiary[];
  pos: PurchaseOrder[];
  grns: GoodsReceipt[];
  invoices: Invoice[];
  people: Person[];
  agents: Agent[];
  bankDirectory: BankAccountRecord[];
  bankScripts: Record<string, BankScript>; // invoiceId -> how the bank answers its first payout
  grnArrivals: { grnId: string; at: ISO }[];
  vendorOnboarding: { vendorId: string; at: ISO }[];
  storyAccounts: { fraud: BankAccountRecord; shivamNew: BankAccountRecord };
}

export interface PaymentIntent {
  v: 1;
  domain: "PAKKA_B2B_INTENT_V1";
  intentId: string;
  companyId: string;
  vendorId: string;
  beneficiaryId: string;
  accountHash: string;
  amount: Paise; // what leaves the account, after TDS
  tds: Paise;
  invoiceIds: string[];
  rail: Rail;
  nonce: number;
  policyVersion: number;
  policyHash: string;
  modelHash: string;
  preparedFor: string; // the maker whose queue this is
  createdAt: ISO;
  expiresAt: ISO;
}

export type Verdict = "approve" | "escalate" | "reject";
export interface Attestation {
  signerId: string; role: AgentRole; verdict: Verdict; reasons: string[]; intentHash: string; signedAt: ISO; sig: string;
}
export interface Approval { personId: string; role: "checker" | "cfo"; intentHash: string; companyId: string; at: ISO; sig: string }

export interface Receipt { intent: PaymentIntent; attestations: Attestation[]; approvals: Approval[] }

export type Actor = "agent" | "guard" | "person" | "bank" | "vendor" | "system";

export interface LedgerEvent {
  seq: number;
  at: ISO;
  companyId: string;
  type: string;
  actor: Actor;
  ruleId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  prev: string;
  hash: string;
}
