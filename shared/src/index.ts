// ============================================================
// BUYFIRE Shared Types & Schemas
// ============================================================

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

export interface ProductSpec {
  key: string;
  value: string;
  unit?: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: Currency;
  stock: number;
  category: string;
  specs: ProductSpec[];
  useCases: string[];
  shippingPromise?: string | null; // null / missing = UNKNOWN
  /** Provenance of shippingPromise. GENERATED never authorizes purchase. */
  shippingFactStatus?: "UNKNOWN" | "GENERATED" | "VERIFIED" | "EXISTING";
  returnPolicy?: string | null;
  bundleIds?: string[];
  imageEmoji?: string;
  isMalicious?: boolean; // for injection demo
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
  type: "max_price" | "min_stock" | "delivery_days" | "category" | "use_case" | "spec";
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
  /** REQUIRED until an explicit merchant (or demo-synthetic) confirmation. */
  merchantVerification?: "REQUIRED" | "DEMO_SYNTHETIC_VERIFIED" | "NOT_REQUIRED";
}

export interface PolicyLimits {
  maxTransactionAmount: number;
  allowedCurrency: Currency[];
  allowedMerchantIds: string[];
  allowedProductIds?: string[];
  humanApprovalRequired: boolean;
  expirationSeconds: number;
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

export type PaymentStatus =
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "DECLINED"
  | "SIMULATED"
  | "BLOCKED";

export interface PaymentAttempt {
  attemptId: string;
  planId: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  adapter: "RazorpayTestAdapter" | "DemoSimulationAdapter";
  message: string;
  isSimulation: boolean;
  timestamp: string;
  errorCode?: string;
}

export type AuditActor =
  | "SYSTEM"
  | "BUYER_AGENT"
  | "POLICY_ENGINE"
  | "PAYMENT_ADAPTER"
  | "SECURITY"
  | "USER";

export interface AuditEvent {
  eventId: string;
  timestamp: string;
  actor: AuditActor;
  missionId?: string;
  runId?: string;
  intent?: string;
  decision?: string;
  amount?: number;
  currency?: Currency;
  action: string;
  result: "SUCCESS" | "FAILURE" | "BLOCKED" | "INFO";
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityAlert {
  alertId: string;
  type: "PROMPT_INJECTION" | "POLICY_VIOLATION" | "UNAUTHORIZED_ACTION";
  severity: "HIGH" | "MEDIUM" | "LOW";
  source: string;
  contentSnippet: string;
  actionTaken: string;
  timestamp: string;
}

export interface DemoState {
  merchant: Merchant;
  mission: BuyerMission | null;
  currentRun: BuyerRunResult | null;
  previousRun: BuyerRunResult | null;
  repair: CommerceRepair | null;
  purchasePlan: PurchasePlan | null;
  payment: PaymentAttempt | null;
  securityAlerts: SecurityAlert[];
  auditEvents: AuditEvent[];
}
