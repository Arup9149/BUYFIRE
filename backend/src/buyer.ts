import { randomUUID } from "crypto";
import type {
  BuyerMission,
  BuyerRunResult,
  BuyerState,
  EvidenceItem,
  Merchant,
  Product,
  StateTransition,
} from "../../shared/src/index";
import { scanProduct } from "./security";
import { recordAudit } from "./audit";

function now(): string {
  return new Date().toISOString();
}

function makeTransition(
  from: BuyerState,
  to: BuyerState,
  summary: string,
  evidence: EvidenceItem[]
): StateTransition {
  return { from, to, timestamp: now(), evidence, summary };
}

/**
 * Deterministic AI buyer state machine.
 * No hidden chain-of-thought; only structured evidence.
 */
export function runBuyer(params: {
  mission: BuyerMission;
  merchant: Merchant;
  repairedProducts?: Map<string, Product>; // overlay repairs
  isRepairedRun?: boolean;
}): BuyerRunResult {
  const { mission, merchant, repairedProducts, isRepairedRun = false } = params;
  const runId = randomUUID();
  const states: StateTransition[] = [];
  const evidenceSummary: EvidenceItem[] = [];
  let selected: Product[] = [];
  let finalState: BuyerState = "DISCOVER";
  let blockedReason: string | undefined;
  let cartTotal = 0;

  const products = merchant.products.map((p) => {
    if (repairedProducts?.has(p.id)) {
      return { ...p, ...repairedProducts.get(p.id)! };
    }
    return p;
  });

  // ---------- DISCOVER ----------
  const discoverEvidence: EvidenceItem[] = [
    {
      type: "info",
      label: "Catalog loaded",
      detail: `${products.length} products from ${merchant.name}`,
    },
    {
      type: "info",
      label: "Mission",
      detail: mission.statement,
    },
  ];
  states.push(
    makeTransition("DISCOVER", "UNDERSTAND", "Catalog and mission loaded", discoverEvidence)
  );
  finalState = "UNDERSTAND";

  // ---------- UNDERSTAND ----------
  const understandEvidence: EvidenceItem[] = mission.constraints.map((c) => ({
    type: "info" as const,
    label: c.label,
    detail: `Constraint type: ${c.type} = ${c.value}`,
  }));
  understandEvidence.push({
    type: "match",
    label: "Persona",
    detail: mission.persona,
  });
  states.push(
    makeTransition(
      "UNDERSTAND",
      "COMPARE",
      "Mission constraints parsed",
      understandEvidence
    )
  );
  finalState = "COMPARE";

  // ---------- COMPARE ----------
  // Filter candidates
  let candidates = products.filter((p) => !p.isMalicious);

  // Security scan first — never act on instruction-like content
  for (const p of products) {
    if (p.isMalicious) {
      const alert = scanProduct(p);
      if (alert) {
        evidenceSummary.push({
          type: "blocked",
          label: "INSTRUCTION-LIKE CONTENT DETECTED",
          detail: alert.actionTaken,
          source: p.id,
        });
        recordAudit({
          actor: "SECURITY",
          action: "PROMPT_INJECTION_BLOCKED",
          result: "BLOCKED",
          missionId: mission.id,
          runId,
          reason: "Merchant content attempted to modify agent behavior",
          metadata: { productId: p.id, alertId: alert.alertId },
        });
      }
    }
  }

  // Apply constraints
  for (const c of mission.constraints) {
    if (c.type === "max_price") {
      candidates = candidates.filter((p) => p.price <= Number(c.value));
    }
    if (c.type === "category") {
      candidates = candidates.filter(
        (p) => p.category.toLowerCase() === String(c.value).toLowerCase()
      );
    }
    if (c.type === "use_case") {
      candidates = candidates.filter((p) =>
        p.useCases.some((u) =>
          u.toLowerCase().includes(String(c.value).toLowerCase())
        )
      );
    }
    if (c.type === "min_stock") {
      candidates = candidates.filter((p) => p.stock >= Number(c.value));
    }
  }

  // Spec heuristics for CAD
  if (mission.persona === "SPECIFICATION_BUYER" || mission.statement.toLowerCase().includes("cad")) {
    candidates = candidates.filter((p) => {
      const hasRam = p.specs.some(
        (s) => s.key === "ram" && parseInt(s.value, 10) >= 16
      );
      const hasGpu = p.specs.some(
        (s) => s.key === "gpu" && /rtx|discrete|nvidia/i.test(s.value)
      );
      return hasRam || hasGpu || p.useCases.includes("CAD");
    });
  }

  // Bundle persona: pick multiple under budget
  if (mission.persona === "BUNDLE_BUYER") {
    const officeItems = products.filter(
      (p) =>
        !p.isMalicious &&
        p.useCases.some((u) => /office|home office/i.test(u)) &&
        p.price < mission.maxAmount
    );
    // Greedy pack under budget
    let remaining = mission.maxAmount;
    selected = [];
    for (const item of officeItems.sort((a, b) => a.price - b.price)) {
      if (item.price <= remaining) {
        selected.push(item);
        remaining -= item.price;
      }
    }
  } else {
    // Prefer best match under price (lowest price among qualified, or highest spec)
    candidates.sort((a, b) => a.price - b.price);
    if (candidates.length > 0) {
      // For CAD prefer higher RAM/GPU if still under budget
      const cadPreferred = candidates
        .filter((p) => p.useCases.includes("CAD"))
        .sort((a, b) => {
          const ramA = parseInt(a.specs.find((s) => s.key === "ram")?.value || "0", 10);
          const ramB = parseInt(b.specs.find((s) => s.key === "ram")?.value || "0", 10);
          return ramB - ramA;
        });
      selected = cadPreferred.length > 0 ? [cadPreferred[0]] : [candidates[0]];
    }
  }

  const compareEvidence: EvidenceItem[] = [
    {
      type: candidates.length > 0 ? "match" : "mismatch",
      label: "Candidates after constraints",
      detail: `${candidates.length} product(s) matched filters`,
    },
  ];
  if (selected.length > 0) {
    for (const s of selected) {
      compareEvidence.push({
        type: "match",
        label: "Selected",
        detail: `${s.name} — ₹${s.price}`,
        source: s.id,
      });
    }
  } else {
    compareEvidence.push({
      type: "mismatch",
      label: "No match",
      detail: "No product satisfied all mission constraints",
    });
  }
  states.push(
    makeTransition("COMPARE", "VERIFY", "Comparison complete", compareEvidence)
  );
  evidenceSummary.push(...compareEvidence);
  finalState = "VERIFY";

  if (selected.length === 0) {
    blockedReason = "No product satisfied the mission constraints.";
    states.push(
      makeTransition("VERIFY", "BLOCKED", blockedReason, [
        { type: "blocked", label: "PURCHASE BLOCKED", detail: blockedReason },
      ])
    );
    finalState = "BLOCKED";
    return buildResult();
  }

  // ---------- VERIFY ----------
  const verifyEvidence: EvidenceItem[] = [];
  let canProceed = true;

  for (const p of selected) {
    // Stock
    if (p.stock <= 0) {
      verifyEvidence.push({
        type: "blocked",
        label: "Out of stock",
        detail: `${p.name} has zero stock`,
        source: p.id,
      });
      canProceed = false;
    } else {
      verifyEvidence.push({
        type: "match",
        label: "Stock verified",
        detail: `${p.name}: ${p.stock} units available`,
        source: p.id,
      });
    }

    // Shipping — UNKNOWN / GENERATED never authorize. Only EXISTING merchant data or VERIFIED confirmation.
    const shippingFact =
      p.shippingFactStatus ||
      (p.shippingPromise && p.shippingPromise !== "UNKNOWN"
        ? "EXISTING"
        : "UNKNOWN");

    if (shippingFact === "UNKNOWN" || !p.shippingPromise || p.shippingPromise === "UNKNOWN") {
      if (shippingFact === "GENERATED") {
        verifyEvidence.push({
          type: "blocked",
          label: "GENERATED STRUCTURE NOT VERIFIED",
          detail:
            "REPAIR: Shipping promise structure = GENERATED. Merchant verification = REQUIRED. GENERATED is not a merchant shipping promise.",
          source: p.id,
        });
        canProceed = false;
        blockedReason =
          "GENERATED shipping is unverified. Merchant verification required.";
      } else {
        verifyEvidence.push({
          type: "blocked",
          label: "SHIPPING PROMISE UNKNOWN",
          detail:
            "ORIGINAL: Shipping promise = UNKNOWN. Merchant did not provide the fact.",
          source: p.id,
        });
        canProceed = false;
        blockedReason = "SHIPPING PROMISE UNKNOWN";
      }
    } else if (shippingFact === "GENERATED") {
      verifyEvidence.push({
        type: "blocked",
        label: "GENERATED STRUCTURE NOT VERIFIED",
        detail:
          "REPAIR: Shipping promise structure = GENERATED. Merchant verification = REQUIRED. GENERATED is not a merchant shipping promise.",
        source: p.id,
      });
      canProceed = false;
      blockedReason =
        "GENERATED shipping is unverified. Merchant verification required.";
    } else if (shippingFact === "VERIFIED") {
      verifyEvidence.push({
        type: "match",
        label: "VERIFIED",
        detail:
          "DEMO / SYNTHETIC MERCHANT VERIFICATION. Not real merchant data. " +
          (p.shippingPromise || ""),
        source: p.id,
      });
    } else {
      // Check urgent delivery constraint
      const deliveryConstraint = mission.constraints.find(
        (c) => c.type === "delivery_days"
      );
      if (deliveryConstraint) {
        // Heuristic: if promise mentions 1-2 or Express, ok; else fail for strict 3-day
        const promise = p.shippingPromise.toLowerCase();
        const urgentOk =
          /1[–-]2|express|same.?day|next.?day|within 1|within 2/i.test(promise);
        if (!urgentOk && Number(deliveryConstraint.value) <= 3) {
          verifyEvidence.push({
            type: "warning",
            label: "Delivery may exceed window",
            detail: `Promise: "${p.shippingPromise}" vs required ≤ ${deliveryConstraint.value} days`,
            source: p.id,
          });
          // For URGENT we still block if not clearly fast
          if (mission.persona === "URGENT_BUYER") {
            canProceed = false;
            blockedReason = `Delivery promise ("${p.shippingPromise}") does not guarantee arrival within ${deliveryConstraint.value} days.`;
          }
        } else {
          verifyEvidence.push({
            type: "match",
            label: "Delivery acceptable",
            detail: p.shippingPromise,
            source: p.id,
          });
        }
      } else {
        verifyEvidence.push({
          type: "match",
          label: "Shipping available",
          detail: p.shippingPromise,
          source: p.id,
        });
      }
    }

    // Price constraint re-check
    if (p.price > mission.maxAmount && mission.persona !== "BUNDLE_BUYER") {
      verifyEvidence.push({
        type: "blocked",
        label: "Price exceeds budget",
        detail: `₹${p.price} > ₹${mission.maxAmount}`,
        source: p.id,
      });
      canProceed = false;
      blockedReason = `Selected product price exceeds mission budget of ₹${mission.maxAmount}.`;
    }
  }

  if (!canProceed) {
    states.push(
      makeTransition(
        "VERIFY",
        "BLOCKED",
        blockedReason || "Verification failed",
        verifyEvidence
      )
    );
    evidenceSummary.push(...verifyEvidence);
    finalState = "BLOCKED";
    return buildResult();
  }

  states.push(
    makeTransition("VERIFY", "CART", "Verification passed", verifyEvidence)
  );
  evidenceSummary.push(...verifyEvidence);
  finalState = "CART";

  // ---------- CART ----------
  cartTotal = selected.reduce((sum, p) => sum + p.price, 0);
  const cartEvidence: EvidenceItem[] = [
    {
      type: "match",
      label: "Cart total",
      detail: `₹${cartTotal} ${mission.currency}`,
    },
    ...selected.map((p) => ({
      type: "match" as const,
      label: "Line item",
      detail: `${p.name} × 1 — ₹${p.price}`,
      source: p.id,
    })),
  ];
  states.push(
    makeTransition("CART", "CHECKOUT", "Items added to cart", cartEvidence)
  );
  finalState = "CHECKOUT";

  // ---------- CHECKOUT (success path) ----------
  states.push(
    makeTransition("CHECKOUT", "COMPLETE", "Ready for payment authorization", [
      {
        type: "match",
        label: "Checkout ready",
        detail: "Purchase plan can now be submitted to policy engine",
      },
    ])
  );
  finalState = "COMPLETE";

  function buildResult(): BuyerRunResult {
    recordAudit({
      actor: "BUYER_AGENT",
      action: isRepairedRun ? "BUYER_RERUN" : "BUYER_RUN",
      result: finalState === "COMPLETE" ? "SUCCESS" : "BLOCKED",
      missionId: mission.id,
      runId,
      intent: mission.statement,
      decision: finalState,
      amount: cartTotal || undefined,
      currency: mission.currency,
      reason: blockedReason,
    });

    return {
      runId,
      missionId: mission.id,
      merchantId: merchant.id,
      persona: mission.persona,
      states,
      finalState,
      selectedProductIds: selected.map((p) => p.id),
      blockedReason,
      cartTotal: cartTotal || undefined,
      currency: mission.currency,
      evidenceSummary,
      isRepairedRun,
      createdAt: now(),
    };
  }

  return buildResult();
}
