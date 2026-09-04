
import { createServer } from "http";
// We test by spawning logic inline via dynamic import of server internals is hard.
// Instead run HTTP-level tests against the live server.
import assert from "assert";

const BASE = process.env.BUYFIRE_URL || "http://localhost:3847";

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const body = await res.json();
  return { status: res.status, body };
}

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS", name); }
  else { failed++; console.log("  FAIL", name, detail || ""); }
}

console.log("BUYFIRE API Tests");
console.log("=================");

const health = await req("/api/health");
ok("health ok", health.status === 200 && health.body.status === "ok");

const merchant = await req("/api/merchant");
ok("merchant loaded", merchant.body.name === "ForgeWorks Station");

const missionRes = await req("/api/missions/generate", { method: "POST", body: JSON.stringify({ persona: "PRICE_HUNTER" }) });
ok("mission generated", missionRes.body.persona === "PRICE_HUNTER" && missionRes.body.maxAmount === 80000);
const mission = missionRes.body;

const run1 = await req("/api/buyer/run", { method: "POST", body: JSON.stringify({ mission }) });
ok("run1 blocked", run1.body.finalState === "BLOCKED");
ok("run1 shipping reason", run1.body.blockedReason === "SHIPPING PROMISE UNKNOWN");

const repairRes = await req("/api/repair", { method: "POST", body: JSON.stringify({ run: run1.body }) });
const shipping = repairRes.body.items.find((i) => i.field === "shipping_promise");
ok("repair generated shipping", shipping && shipping.status === "GENERATED");
ok("generated not a merchant fact", repairRes.body.machineReadableOffer.shipping == null);
ok("merchant verification required", repairRes.body.merchantVerification === "REQUIRED");

const runGenerated = await req("/api/buyer/run", { method: "POST", body: JSON.stringify({ mission, isRepairedRun: true, repair: repairRes.body }) });
ok("generated repair still blocked", runGenerated.body.finalState === "BLOCKED");
ok("generated marked unverified", /GENERATED|unverified/i.test(runGenerated.body.blockedReason || ""));

const verifyRes = await req("/api/repair/verify-merchant", { method: "POST", body: JSON.stringify({ repair: repairRes.body }) });
ok("synthetic verification labeled", /DEMO \/ SYNTHETIC MERCHANT VERIFICATION/.test(String(verifyRes.body.items.find((i) => i.field === "shipping_promise")?.generated || "")));
ok("verified status", verifyRes.body.items.find((i) => i.field === "shipping_promise")?.status === "VERIFIED");

const run2 = await req("/api/buyer/run", { method: "POST", body: JSON.stringify({ mission, isRepairedRun: true, repair: verifyRes.body }) });
ok("run2 complete", run2.body.finalState === "COMPLETE");
ok("run2 cart", run2.body.cartTotal === 74990);

const plan = await req("/api/policy/evaluate", { method: "POST", body: JSON.stringify({
  amount: run2.body.cartTotal, currency: "INR", merchantId: "merchant_demo_workstation",
  productIds: run2.body.selectedProductIds, missionId: mission.id, runId: run2.body.runId,
})});
ok("policy approved", plan.body.approved === true);

const overLimit = await req("/api/policy/evaluate", { method: "POST", body: JSON.stringify({
  amount: 200000, currency: "INR", merchantId: "merchant_demo_workstation",
  productIds: ["prod_laptop_cad_pro"], missionId: mission.id, runId: "r-over",
})});
ok("policy rejects high amount", overLimit.body.approved === false);

const badCurrency = await req("/api/policy/evaluate", { method: "POST", body: JSON.stringify({
  amount: 1000, currency: "USD", merchantId: "merchant_demo_workstation",
  productIds: ["prod_laptop_cad_pro"], missionId: mission.id, runId: "r-usd",
})});
ok("policy rejects USD", badCurrency.body.approved === false);

const mutatedPay = await req("/api/payment/charge", { method: "POST", body: JSON.stringify({ plan: { ...plan.body, amount: 1, currency: "USD", merchantId: "evil_merchant", productIds: ["prod_malicious"], planId: "forged_plan" } }) });
ok("mutated plan rejected", mutatedPay.status === 403);

const tamper = await req("/api/payment/charge", { method: "POST", body: JSON.stringify({ plan: { ...plan.body, amount: 1, currency: "USD" } }) });
ok("tampered fields ignored", tamper.body.status === "SIMULATED" && tamper.body.amount === 74990 && tamper.body.currency === "INR");

const pay = await req("/api/payment/charge", { method: "POST", body: JSON.stringify({ plan: plan.body }) });
ok("payment simulated", pay.body.status === "SIMULATED" && pay.body.isSimulation === true);
ok("payment uses policy amount", pay.body.amount === 74990 && pay.body.currency === "INR");
ok("payment label", /SIMULATION/.test(pay.body.message) && /NO REAL MONEY/.test(pay.body.message));

const payFail = await req("/api/payment/charge", { method: "POST", body: JSON.stringify({ plan: plan.body, forceFail: true }) });
ok("payment fail no retry", payFail.body.status === "DECLINED" && /No duplicate retry/.test(payFail.body.message));

const sec = await req("/api/security/scan", { method: "POST", body: JSON.stringify({ productId: "prod_malicious" }) });
ok("injection blocked", sec.body.blocked === true && sec.body.alert.type === "PROMPT_INJECTION");

const clean = await req("/api/security/scan", { method: "POST", body: JSON.stringify({ productId: "prod_laptop_cad_pro" }) });
ok("clean product ok", clean.body.blocked === false);

const audit = await req("/api/audit");
ok("audit has events", audit.body.length > 0);
ok("audit records repair", audit.body.some((e) => e.action === "REPAIR_GENERATED"));
ok("audit records verification", audit.body.some((e) => e.action === "MERCHANT_VERIFICATION_SIMULATED"));
const hasSecret = audit.body.some((e) => e.metadata && (e.metadata.apiKey || e.metadata.secret));
ok("audit no secrets", !hasSecret);

console.log("-----------------");
console.log("Passed:", passed, "Failed:", failed);
process.exit(failed > 0 ? 1 : 0);
