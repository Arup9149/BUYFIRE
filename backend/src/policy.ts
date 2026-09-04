import { randomUUID } from "crypto";
import type {
  PolicyLimits,
  PurchasePlan,
  Currency,
} from "../../shared/src/index";
import { DEMO_MERCHANT } from "./catalog";

export const DEFAULT_POLICY: PolicyLimits = {
  maxTransactionAmount: 100000, // ₹1,00,000 hard ceiling
  allowedCurrency: ["INR"],
  allowedMerchantIds: [DEMO_MERCHANT.id],
  humanApprovalRequired: false, // demo mode: auto for simulation
  expirationSeconds: 900, // 15 min
};

export function evaluatePolicy(params: {
  amount: number;
  currency: Currency;
  merchantId: string;
  productIds: string[];
  missionId: string;
  runId: string;
  forceFail?: boolean;
}): PurchasePlan {
  const { amount, currency, merchantId, productIds, missionId, runId } = params;
  const policy = DEFAULT_POLICY;
  const checks: PurchasePlan["policyChecks"] = [];

  // Amount
  const amountOk = amount > 0 && amount <= policy.maxTransactionAmount;
  checks.push({
    rule: "MAX_TRANSACTION_AMOUNT",
    passed: amountOk,
    detail: amountOk
      ? `Amount ₹${amount} within limit ₹${policy.maxTransactionAmount}`
      : `Amount ₹${amount} exceeds limit ₹${policy.maxTransactionAmount}`,
  });

  // Currency
  const currencyOk = policy.allowedCurrency.includes(currency);
  checks.push({
    rule: "ALLOWED_CURRENCY",
    passed: currencyOk,
    detail: currencyOk
      ? `Currency ${currency} allowed`
      : `Currency ${currency} not in allowed list`,
  });

  // Merchant
  const merchantOk = policy.allowedMerchantIds.includes(merchantId);
  checks.push({
    rule: "ALLOWED_MERCHANT",
    passed: merchantOk,
    detail: merchantOk
      ? `Merchant ${merchantId} allowed`
      : `Merchant ${merchantId} not allowed`,
  });

  // Product presence
  const productsOk = productIds.length > 0;
  checks.push({
    rule: "ALLOWED_PRODUCT",
    passed: productsOk,
    detail: productsOk
      ? `${productIds.length} product(s) selected`
      : "No products selected",
  });

  // Expiration
  const expiresAt = new Date(
    Date.now() + policy.expirationSeconds * 1000
  ).toISOString();
  checks.push({
    rule: "EXPIRATION",
    passed: true,
    detail: `Plan expires at ${expiresAt}`,
  });

  // Idempotency key
  const idempotencyKey = `idem_${runId}_${productIds.sort().join("_")}_${amount}`;
  checks.push({
    rule: "IDEMPOTENCY_KEY",
    passed: true,
    detail: `Key: ${idempotencyKey.slice(0, 24)}…`,
  });

  const allPassed = checks.every((c) => c.passed) && !params.forceFail;

  return {
    planId: randomUUID(),
    missionId,
    runId,
    productIds,
    amount,
    currency,
    merchantId,
    idempotencyKey,
    expiresAt,
    approved: allPassed && !policy.humanApprovalRequired,
    policyChecks: checks,
  };
}
