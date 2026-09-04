import express from "express";
import cors from "cors";
import { DEMO_MERCHANT, getMerchant } from "./catalog";
import { generateMission, listPersonas } from "./missions";
import { runBuyer } from "./buyer";
import { generateRepair, applyRepairToProduct, simulateMerchantVerification } from "./repair";
import { evaluatePolicy } from "./policy";
import { getPaymentAdapter, DemoSimulationAdapter } from "./payments";
import { getAuditEvents, recordAudit, clearAudit } from "./audit";
import { scanProduct, detectPromptInjection } from "./security";
import type { BuyerPersona, Product } from "../../shared/src/index";

const app = express();
const PORT = Number(process.env.PORT) || 3847;
const approvedPlans = new Map<string, ReturnType<typeof evaluatePolicy>>();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- Health ----------
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "BUYFIRE",
    tagline: "Attack your store with AI buyers before real AI buyers do.",
    timestamp: new Date().toISOString(),
  });
});

// ---------- Merchant / Catalog ----------
app.get("/api/merchant", (_req, res) => {
  const m = getMerchant();
  res.json({
    id: m.id,
    name: m.name,
    category: m.category,
    description: m.description,
    currency: m.currency,
    productCount: m.products.length,
  });
});

app.get("/api/catalog", (_req, res) => {
  res.json(DEMO_MERCHANT.products);
});

// ---------- Missions ----------
app.get("/api/personas", (_req, res) => {
  res.json(listPersonas());
});

app.post("/api/missions/generate", (req, res) => {
  const persona = (req.body?.persona as BuyerPersona) || "PRICE_HUNTER";
  try {
    const mission = generateMission(persona);
    recordAudit({
      actor: "USER",
      action: "MISSION_GENERATED",
      result: "SUCCESS",
      missionId: mission.id,
      intent: mission.statement,
    });
    res.json(mission);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Buyer Run ----------
app.post("/api/buyer/run", (req, res) => {
  const { mission, isRepairedRun, repair } = req.body;
  if (!mission) {
    return res.status(400).json({ error: "mission required" });
  }

  let repairedMap: Map<string, Product> | undefined;
  if (isRepairedRun && repair) {
    repairedMap = new Map();
    const base = DEMO_MERCHANT.products.find((p) => p.id === repair.productId);
    if (base) {
      repairedMap.set(repair.productId, applyRepairToProduct(base, repair));
    }
  }

  const result = runBuyer({
    mission,
    merchant: DEMO_MERCHANT,
    repairedProducts: repairedMap,
    isRepairedRun: Boolean(isRepairedRun),
  });
  res.json(result);
});

// ---------- Repair ----------
app.post("/api/repair", (req, res) => {
  const { run } = req.body;
  if (!run) return res.status(400).json({ error: "run required" });
  const repair = generateRepair(run);
  if (!repair) return res.status(404).json({ error: "Could not generate repair" });
  res.json(repair);
});

app.post("/api/repair/verify-merchant", (req, res) => {
  const { repair } = req.body;
  if (!repair) return res.status(400).json({ error: "repair required" });
  res.json(simulateMerchantVerification(repair));
});

// ---------- Policy / Purchase Plan ----------
app.post("/api/policy/evaluate", (req, res) => {
  const { amount, currency, merchantId, productIds, missionId, runId } = req.body;
  if (amount == null || !currency || !merchantId || !missionId || !runId) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const plan = evaluatePolicy({
    amount,
    currency,
    merchantId,
    productIds: productIds || [],
    missionId,
    runId,
  });
  if (plan.approved) approvedPlans.set(plan.planId, plan);
  recordAudit({
    actor: "POLICY_ENGINE",
    action: "POLICY_EVALUATION",
    result: plan.approved ? "SUCCESS" : "BLOCKED",
    missionId,
    runId,
    amount,
    currency,
    decision: plan.approved ? "APPROVED" : "REJECTED",
    reason: plan.policyChecks
      .filter((c) => !c.passed)
      .map((c) => c.detail)
      .join("; ") || "All checks passed",
  });
  res.json(plan);
});

// ---------- Payment ----------
app.post("/api/payment/charge", async (req, res) => {
  const { plan, forceFail, preferSimulation } = req.body;
  if (!plan) return res.status(400).json({ error: "plan required" });

  const stored = approvedPlans.get(plan.planId);
  if (!stored || !stored.approved) {
    return res.status(403).json({
      error: "Purchase plan not approved by policy engine",
    });
  }

  // Never allow model/output to supply credentials or override adapter
  const adapter =
    preferSimulation || forceFail
      ? new DemoSimulationAdapter()
      : getPaymentAdapter();

  const attempt = await adapter.charge(stored, { forceFail: Boolean(forceFail) });
  res.json(attempt);
});

app.get("/api/payment/adapter", (_req, res) => {
  const adapter = getPaymentAdapter();
  res.json({
    active: adapter.name,
    razorpayConfigured: process.env.RAZORPAY_KEY_ID ? true : false,
    note:
      adapter.name === "DemoSimulationAdapter"
        ? "SIMULATION — NO REAL MONEY MOVED"
        : "Razorpay TEST MODE path available",
  });
});

// ---------- Security Attack Demo ----------
app.post("/api/security/scan", (req, res) => {
  const { productId, text } = req.body;
  if (productId) {
    const product = DEMO_MERCHANT.products.find((p) => p.id === productId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    const alert = scanProduct(product);
    if (alert) {
      recordAudit({
        actor: "SECURITY",
        action: "PROMPT_INJECTION_SCAN",
        result: "BLOCKED",
        reason: alert.actionTaken,
        metadata: { productId, alertId: alert.alertId },
      });
      return res.json({ blocked: true, alert });
    }
    return res.json({ blocked: false, message: "No injection detected" });
  }
  if (text) {
    const alert = detectPromptInjection(text, "manual");
    if (alert) {
      recordAudit({
        actor: "SECURITY",
        action: "PROMPT_INJECTION_SCAN",
        result: "BLOCKED",
        reason: alert.actionTaken,
      });
      return res.json({ blocked: true, alert });
    }
    return res.json({ blocked: false, message: "No injection detected" });
  }
  res.status(400).json({ error: "productId or text required" });
});

// ---------- Audit ----------
app.get("/api/audit", (_req, res) => {
  res.json(getAuditEvents());
});

app.post("/api/audit/clear", (_req, res) => {
  clearAudit();
  res.json({ cleared: true });
});

// ---------- Full Demo Orchestration (optional convenience) ----------
app.post("/api/demo/full", async (req, res) => {
  clearAudit();
  const persona = (req.body?.persona as BuyerPersona) || "PRICE_HUNTER";
  const mission = generateMission(persona);
  recordAudit({
    actor: "USER",
    action: "DEMO_STARTED",
    result: "INFO",
    missionId: mission.id,
    intent: mission.statement,
  });

  // First run — expect block on shipping for CAD Pro
  const run1 = runBuyer({ mission, merchant: DEMO_MERCHANT });
  const repair = generateRepair(run1);

  let run2 = null;
  let generatedRun = null;
  let plan = null;
  let payment = null;

  if (repair) {
    const repairedMap = new Map<string, Product>();
    const base = DEMO_MERCHANT.products.find((p) => p.id === repair.productId);
    if (base) {
      repairedMap.set(repair.productId, applyRepairToProduct(base, repair));
      generatedRun = runBuyer({
        mission,
        merchant: DEMO_MERCHANT,
        repairedProducts: repairedMap,
        isRepairedRun: true,
      });
    }

    const verifiedRepair = simulateMerchantVerification(repair);
    const verifiedMap = new Map<string, Product>();
    if (base) {
      verifiedMap.set(repair.productId, applyRepairToProduct(base, verifiedRepair));
    }
    run2 = runBuyer({
      mission,
      merchant: DEMO_MERCHANT,
      repairedProducts: verifiedMap,
      isRepairedRun: true,
    });

    if (run2.finalState === "COMPLETE" && run2.cartTotal) {
      plan = evaluatePolicy({
        amount: run2.cartTotal,
        currency: run2.currency || "INR",
        merchantId: DEMO_MERCHANT.id,
        productIds: run2.selectedProductIds,
        missionId: mission.id,
        runId: run2.runId,
      });
      if (plan.approved) {
        approvedPlans.set(plan.planId, plan);
        const adapter = new DemoSimulationAdapter();
        payment = await adapter.charge(plan);
      }
    }
  }

  // Security scan on malicious product
  const malicious = DEMO_MERCHANT.products.find((p) => p.isMalicious)!;
  const securityAlert = scanProduct(malicious);
  if (securityAlert) {
    recordAudit({
      actor: "SECURITY",
      action: "PROMPT_INJECTION_BLOCKED",
      result: "BLOCKED",
      reason: "Merchant content attempted to modify agent behavior",
      metadata: { productId: malicious.id },
    });
  }

  // Payment failure demo
  let paymentFail = null;
  if (plan) {
    const adapter = new DemoSimulationAdapter();
    paymentFail = await adapter.charge(plan, { forceFail: true });
  }

  res.json({
    merchant: {
      id: DEMO_MERCHANT.id,
      name: DEMO_MERCHANT.name,
    },
    mission,
    run1,
    repair,
    generatedRun,
    run2,
    plan,
    payment,
    securityAlert,
    paymentFail,
    audit: getAuditEvents(),
  });
});

app.listen(PORT, () => {
  console.log(`BUYFIRE backend listening on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
