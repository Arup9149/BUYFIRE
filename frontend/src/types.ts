export type BuyerPersona =
  | "PRICE_HUNTER"
  | "SPECIFICATION_BUYER"
  | "URGENT_BUYER"
  | "BUNDLE_BUYER"
  | "CONSTRAINT_BUYER";

export type BuyerState =
  | "DISCOVER"
  | "UNDERSTAND"
  | "COMPARE"
  | "VERIFY"
  | "CART"
  | "CHECKOUT"
  | "COMPLETE"
  | "BLOCKED";

export type Currency = "INR" | "USD";

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: Currency;
  stock: number;
  category: string;
  specs: { key: string; value: string; unit?: string }[];
  useCases: string[];
  shippingPromise?: string | null;
  shippingFactStatus?: "UNKNOWN" | "GENERATED" | "VERIFIED" | "EXISTING";
  returnPolicy?: string | null;
  imageEmoji?: string;
  isMalicious?: boolean;
}

export interface Merchant {
  id: string;
  name: string;
  category: string;
  description: string;
  currency: Currency;
  products: Product[];
}

export interface MissionConstraint {
  type: string;
  value: string | number;
  label: string;
}

export interface BuyerMission {
  id: string;
  persona: BuyerPersona;
  statement: string;
  constraints: MissionConstraint[];
  targetCategory?: string;
  maxAmount: number;
  currency: Currency;
  createdAt: string;
}

export interface EvidenceItem {
  type: "match" | "mismatch" | "unknown" | "warning" | "blocked" | "info";
  label: string;
  detail: string;
  source?: string;
}

export interface StateTransition {
  from: BuyerState;
  to: BuyerState;
  timestamp: string;
  evidence: EvidenceItem[];
  summary: string;
}

export interface BuyerRunResult {
  runId: string;
  missionId: string;
  merchantId: string;
  persona: BuyerPersona;
  states: StateTransition[];
  finalState: BuyerState;
  selectedProductIds: string[];
  blockedReason?: string;
  cartTotal?: number;
  currency?: Currency;
  evidenceSummary: EvidenceItem[];
  isRepairedRun: boolean;
  createdAt: string;
}

export interface RepairItem {
  field: string;
  existing: string | number | null;
  generated: string | number | null;
  status: "EXISTING" | "GENERATED" | "UNKNOWN" | "VERIFIED";
  note?: string;
}

export interface CommerceRepair {
  repairId: string;
  productId: string;
  productName: string;
  items: RepairItem[];
  machineReadableOffer: Record<string, unknown>;
  createdAt: string;
  merchantVerification?: "REQUIRED" | "DEMO_SYNTHETIC_VERIFIED" | "NOT_REQUIRED";
}

export interface PurchasePlan {
  planId: string;
  missionId: string;
  runId: string;
  productIds: string[];
  amount: number;
  currency: Currency;
  merchantId: string;
  idempotencyKey: string;
  expiresAt: string;
  approved: boolean;
  policyChecks: { rule: string; passed: boolean; detail: string }[];
}

export interface PaymentAttempt {
  attemptId: string;
  planId: string;
  amount: number;
  currency: Currency;
  status: string;
  adapter: string;
  message: string;
  isSimulation: boolean;
  timestamp: string;
  errorCode?: string;
}

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  actor: string;
  missionId?: string;
  runId?: string;
  intent?: string;
  decision?: string;
  amount?: number;
  currency?: Currency;
  action: string;
  result: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityAlert {
  alertId: string;
  type: string;
  severity: string;
  source: string;
  contentSnippet: string;
  actionTaken: string;
  timestamp: string;
}

export type Screen =
  | "landing"
  | "mission"
  | "run"
  | "crash"
  | "repair"
  | "beforeafter"
  | "payment"
  | "security"
  | "audit";
