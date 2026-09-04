import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateMission } from "./missions";
import { runBuyer } from "./buyer";
import {
  generateRepair,
  applyRepairToProduct,
  simulateMerchantVerification,
} from "./repair";
import { evaluatePolicy, DEFAULT_POLICY } from "./policy";
import { DemoSimulationAdapter } from "./payments";
import { detectPromptInjection, scanProduct, isInstructionLike } from "./security";
import { DEMO_MERCHANT, getProduct } from "./catalog";
import { recordAudit, getAuditEvents, clearAudit } from "./audit";
import type { Product } from "../../shared/src/index";

describe("BUYFIRE Core", () => {
  it("generates PRICE_HUNTER mission from catalog", () => {
    const m = generateMission("PRICE_HUNTER");
    assert.equal(m.persona, "PRICE_HUNTER");
    assert.ok(m.statement.includes("CAD") || m.statement.includes("laptop"));
    assert.equal(m.maxAmount, 80000);
    assert.equal(m.currency, "INR");
  });

  it("UNKNOWN shipping blocks purchase", () => {
    const mission = generateMission("PRICE_HUNTER");
    const result = runBuyer({ mission, merchant: DEMO_MERCHANT });
    assert.equal(result.finalState, "BLOCKED");
    assert.equal(result.blockedReason, "SHIPPING PROMISE UNKNOWN");
    const labels = result.states.flatMap((s) => s.evidence.map((e) => e.label));
    assert.ok(labels.includes("SHIPPING PROMISE UNKNOWN"));
  });

  it("GENERATED shipping alone does not authorize purchase", () => {
    const mission = generateMission("PRICE_HUNTER");
    const run1 = runBuyer({ mission, merchant: DEMO_MERCHANT });
    const repair = generateRepair(run1)!;
    const shipping = repair.items.find((i) => i.field === "shipping_promise")!;
    assert.equal(shipping.status, "GENERATED");
    assert.equal(repair.merchantVerification, "REQUIRED");
    const base = getProduct(repair.productId)!;
    const overlay = applyRepairToProduct(base, repair);
    assert.equal(overlay.shippingFactStatus, "GENERATED");
    assert.ok(!overlay.shippingPromise);
    const map = new Map<string, Product>();
    map.set(repair.productId, overlay);
    const run2 = runBuyer({
      mission,
      merchant: DEMO_MERCHANT,
      repairedProducts: map,
      isRepairedRun: true,
    });
    assert.equal(run2.finalState, "BLOCKED");
    assert.match(run2.blockedReason || "", /GENERATED|unverified/i);
  });

  it("GENERATED repair is visibly marked unverified", () => {
    const mission = generateMission("PRICE_HUNTER");
    const run = runBuyer({ mission, merchant: DEMO_MERCHANT });
    const repair = generateRepair(run)!;
    const shipping = repair.items.find((i) => i.field === "shipping_promise")!;
    assert.equal(shipping.status, "GENERATED");
    assert.match(String(shipping.generated), /GENERATED|ShippingPromiseSchema/);
    assert.match(shipping.note || "", /Merchant verification = REQUIRED/i);
    assert.equal(repair.machineReadableOffer.shippingStatus, "GENERATED");
    assert.equal(repair.machineReadableOffer.merchantVerification, "REQUIRED");
    assert.equal(repair.machineReadableOffer.shipping, null);
  });

  it("VERIFIED simulated merchant shipping permits rerun to COMPLETE", () => {
    clearAudit();
    const mission = generateMission("PRICE_HUNTER");
    const run1 = runBuyer({ mission, merchant: DEMO_MERCHANT });
    assert.equal(run1.finalState, "BLOCKED");
    const repair = generateRepair(run1)!;
    const verified = simulateMerchantVerification(repair);
    const shipping = verified.items.find((i) => i.field === "shipping_promise")!;
    assert.equal(shipping.status, "VERIFIED");
    assert.match(String(shipping.generated), /DEMO \/ SYNTHETIC MERCHANT VERIFICATION/);
    assert.equal(verified.merchantVerification, "DEMO_SYNTHETIC_VERIFIED");
    const base = getProduct(verified.productId)!;
    const overlay = applyRepairToProduct(base, verified);
    assert.equal(overlay.shippingFactStatus, "VERIFIED");
    const map = new Map<string, Product>();
    map.set(verified.productId, overlay);
    const run2 = runBuyer({
      mission,
      merchant: DEMO_MERCHANT,
      repairedProducts: map,
      isRepairedRun: true,
    });
    assert.equal(run2.finalState, "COMPLETE");
    assert.ok(run2.cartTotal && run2.cartTotal > 0);
    const actions = getAuditEvents().map((e) => e.action);
    assert.ok(actions.includes("REPAIR_GENERATED"));
    assert.ok(actions.includes("MERCHANT_VERIFICATION_SIMULATED"));
  });

  it("policy rejects over-limit amount", () => {
    const plan = evaluatePolicy({
      amount: DEFAULT_POLICY.maxTransactionAmount + 1,
      currency: "INR",
      merchantId: DEMO_MERCHANT.id,
      productIds: ["prod_laptop_cad_pro"],
      missionId: "m1",
      runId: "r1",
    });
    assert.equal(plan.approved, false);
    assert.ok(plan.policyChecks.some((c) => c.rule === "MAX_TRANSACTION_AMOUNT" && !c.passed));
  });

  it("policy accepts valid plan", () => {
    const plan = evaluatePolicy({
      amount: 74990,
      currency: "INR",
      merchantId: DEMO_MERCHANT.id,
      productIds: ["prod_laptop_cad_pro"],
      missionId: "m1",
      runId: "r1",
    });
    assert.equal(plan.approved, true);
    assert.ok(plan.idempotencyKey.length > 10);
  });

  it("detects prompt injection in malicious product", () => {
    const malicious = DEMO_MERCHANT.products.find((p) => p.isMalicious)!;
    assert.ok(isInstructionLike(malicious.description));
    const alert = scanProduct(malicious);
    assert.ok(alert);
    assert.equal(alert!.type, "PROMPT_INJECTION");
    assert.equal(alert!.severity, "HIGH");
  });

  it("does not flag clean product as injection", () => {
    const clean = getProduct("prod_laptop_cad_pro")!;
    const alert = scanProduct(clean);
    assert.equal(alert, null);
  });

  it("simulation payment succeeds with label", async () => {
    const plan = evaluatePolicy({
      amount: 74990,
      currency: "INR",
      merchantId: DEMO_MERCHANT.id,
      productIds: ["prod_laptop_cad_pro"],
      missionId: "m1",
      runId: "r1",
    });
    const adapter = new DemoSimulationAdapter();
    const attempt = await adapter.charge(plan);
    assert.equal(attempt.isSimulation, true);
    assert.equal(attempt.status, "SIMULATED");
    assert.ok(attempt.message.includes("SIMULATION"));
    assert.ok(attempt.message.includes("NO REAL MONEY"));
  });

  it("payment failure does not retry", async () => {
    const plan = evaluatePolicy({
      amount: 74990,
      currency: "INR",
      merchantId: DEMO_MERCHANT.id,
      productIds: ["prod_laptop_cad_pro"],
      missionId: "m1",
      runId: "r1",
    });
    const adapter = new DemoSimulationAdapter();
    const attempt = await adapter.charge(plan, { forceFail: true });
    assert.equal(attempt.status, "DECLINED");
    assert.ok(attempt.message.includes("No duplicate retry"));
  });

  it("audit events are recorded without secrets", () => {
    clearAudit();
    recordAudit({
      actor: "SYSTEM",
      action: "TEST",
      result: "INFO",
      metadata: { apiKey: "secret123", safe: "ok" },
    });
    const events = getAuditEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata?.apiKey, undefined);
    assert.equal(events[0].metadata?.safe, "ok");
  });

  it("currency restriction works", () => {
    const plan = evaluatePolicy({
      amount: 100,
      currency: "USD" as any,
      merchantId: DEMO_MERCHANT.id,
      productIds: ["prod_laptop_cad_pro"],
      missionId: "m1",
      runId: "r1",
    });
    assert.equal(plan.approved, false);
  });
});
