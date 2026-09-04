import { randomUUID } from "crypto";
import type { PaymentAttempt, PurchasePlan } from "../../shared/src/index";
import { recordAudit } from "./audit";

export interface PaymentAdapter {
  name: "RazorpayTestAdapter" | "DemoSimulationAdapter";
  charge(plan: PurchasePlan, options?: { forceFail?: boolean }): Promise<PaymentAttempt>;
}

/**
 * DemoSimulationAdapter — always clearly labelled SIMULATION.
 * No real money moved. No external calls.
 */
export class DemoSimulationAdapter implements PaymentAdapter {
  name = "DemoSimulationAdapter" as const;

  async charge(
    plan: PurchasePlan,
    options?: { forceFail?: boolean }
  ): Promise<PaymentAttempt> {
    // Idempotency: same key should not create duplicate success in real system.
    // Here we just record the attempt.

    if (options?.forceFail) {
      const attempt: PaymentAttempt = {
        attemptId: randomUUID(),
        planId: plan.planId,
        amount: plan.amount,
        currency: plan.currency,
        status: "DECLINED",
        adapter: this.name,
        message:
          "SIMULATION — Payment declined (test failure). No duplicate retry was initiated.",
        isSimulation: true,
        timestamp: new Date().toISOString(),
        errorCode: "SIM_DECLINED",
      };
      recordAudit({
        actor: "PAYMENT_ADAPTER",
        action: "PAYMENT_ATTEMPT",
        result: "FAILURE",
        missionId: plan.missionId,
        runId: plan.runId,
        amount: plan.amount,
        currency: plan.currency,
        reason: attempt.message,
        metadata: { attemptId: attempt.attemptId, adapter: this.name },
      });
      return attempt;
    }

    const attempt: PaymentAttempt = {
      attemptId: randomUUID(),
      planId: plan.planId,
      amount: plan.amount,
      currency: plan.currency,
      status: "SIMULATED",
      adapter: this.name,
      message: "SIMULATION — NO REAL MONEY MOVED. Payment recorded in test ledger only.",
      isSimulation: true,
      timestamp: new Date().toISOString(),
    };
    recordAudit({
      actor: "PAYMENT_ADAPTER",
      action: "PAYMENT_ATTEMPT",
      result: "SUCCESS",
      missionId: plan.missionId,
      runId: plan.runId,
      amount: plan.amount,
      currency: plan.currency,
      reason: attempt.message,
      metadata: { attemptId: attempt.attemptId, adapter: this.name },
    });
    return attempt;
  }
}

/**
 * RazorpayTestAdapter — skeleton only.
 * Requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in env.
 * Never exposes secrets to frontend.
 * If credentials missing, refuses to pretend success.
 */
export class RazorpayTestAdapter implements PaymentAdapter {
  name = "RazorpayTestAdapter" as const;

  private keyId = process.env.RAZORPAY_KEY_ID;
  private keySecret = process.env.RAZORPAY_KEY_SECRET;

  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  async charge(
    plan: PurchasePlan,
    options?: { forceFail?: boolean }
  ): Promise<PaymentAttempt> {
    if (!this.isConfigured()) {
      const attempt: PaymentAttempt = {
        attemptId: randomUUID(),
        planId: plan.planId,
        amount: plan.amount,
        currency: plan.currency,
        status: "BLOCKED",
        adapter: this.name,
        message:
          "Razorpay credentials not configured. Falling back is the caller's responsibility. NO TRANSACTION CREATED.",
        isSimulation: false,
        timestamp: new Date().toISOString(),
        errorCode: "NO_CREDENTIALS",
      };
      recordAudit({
        actor: "PAYMENT_ADAPTER",
        action: "PAYMENT_ATTEMPT",
        result: "BLOCKED",
        missionId: plan.missionId,
        runId: plan.runId,
        amount: plan.amount,
        currency: plan.currency,
        reason: attempt.message,
      });
      return attempt;
    }

    // Real integration would call Razorpay Orders API here with idempotency key.
    // We deliberately do NOT fake a success response.
    if (options?.forceFail) {
      return {
        attemptId: randomUUID(),
        planId: plan.planId,
        amount: plan.amount,
        currency: plan.currency,
        status: "DECLINED",
        adapter: this.name,
        message: "Razorpay TEST MODE — payment declined (forced).",
        isSimulation: false,
        timestamp: new Date().toISOString(),
        errorCode: "TEST_DECLINED",
      };
    }

    // Without live call we still refuse to invent a captured payment
    return {
      attemptId: randomUUID(),
      planId: plan.planId,
      amount: plan.amount,
      currency: plan.currency,
      status: "PENDING",
      adapter: this.name,
      message:
        "Razorpay TEST MODE credentials present but live order creation is disabled in this demo build. Use DemoSimulationAdapter for end-to-end simulation.",
      isSimulation: false,
      timestamp: new Date().toISOString(),
      errorCode: "LIVE_CALL_DISABLED",
    };
  }
}

export function getPaymentAdapter(): PaymentAdapter {
  const razor = new RazorpayTestAdapter();
  if (razor.isConfigured()) {
    return razor;
  }
  return new DemoSimulationAdapter();
}
