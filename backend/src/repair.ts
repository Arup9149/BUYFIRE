import { randomUUID } from "crypto";
import type {
  CommerceRepair,
  Product,
  RepairItem,
  BuyerRunResult,
} from "../../shared/src/index";
import { getProduct } from "./catalog";
import { recordAudit } from "./audit";

/** Schema only — no invented delivery date, carrier, cost, geography, or guarantee. */
export const SHIPPING_PROMISE_SCHEMA = {
  "@type": "ShippingPromiseSchema",
  provenance: "GENERATED",
  merchantVerification: "REQUIRED",
  fields: {
    deliveryWindow: null,
    carrier: null,
    deliveryGuarantee: null,
    shippingCost: null,
    geographicAvailability: null,
    merchantPromise: null,
  },
  note: "Structure only. BUYFIRE does not invent merchant shipping facts.",
} as const;

export const DEMO_SYNTHETIC_SHIPPING_CONFIRMATION =
  "[DEMO / SYNTHETIC MERCHANT VERIFICATION] Simulated merchant confirmed that a shipping promise exists for this SKU. This is not live merchant production data. No carrier, cost, geography, or calendar delivery date is asserted as an original merchant fact.";

/**
 * Generate structured machine-commerce repair data.
 * Never hallucinate missing facts — mark UNKNOWN.
 */
export function generateRepair(run: BuyerRunResult): CommerceRepair | null {
  if (run.finalState !== "BLOCKED" || run.selectedProductIds.length === 0) {
    // Still try primary selected or first CAD product for demo
    const fallbackId =
      run.selectedProductIds[0] || "prod_laptop_cad_pro";
    return buildRepairForProduct(fallbackId, run);
  }
  return buildRepairForProduct(run.selectedProductIds[0], run);
}

function buildRepairForProduct(
  productId: string,
  run: BuyerRunResult
): CommerceRepair | null {
  const product = getProduct(productId);
  if (!product) return null;

  const items: RepairItem[] = [];

  // Existing fields
  items.push({
    field: "name",
    existing: product.name,
    generated: product.name,
    status: "EXISTING",
  });
  items.push({
    field: "price",
    existing: product.price,
    generated: product.price,
    status: "EXISTING",
  });
  items.push({
    field: "currency",
    existing: product.currency,
    generated: product.currency,
    status: "EXISTING",
  });
  items.push({
    field: "stock",
    existing: product.stock,
    generated: product.stock,
    status: "EXISTING",
  });
  items.push({
    field: "specs",
    existing: product.specs.map((s) => `${s.key}:${s.value}`).join(", "),
    generated: product.specs.map((s) => `${s.key}:${s.value}`).join(", "),
    status: "EXISTING",
  });
  items.push({
    field: "use_cases",
    existing: product.useCases.join(", "),
    generated: product.useCases.join(", "),
    status: "EXISTING",
  });

  // Shipping — the deliberate gap. GENERATED is schema only, never a merchant fact.
  if (!product.shippingPromise) {
    items.push({
      field: "shipping_promise",
      existing: null,
      generated: JSON.stringify(SHIPPING_PROMISE_SCHEMA),
      status: "GENERATED",
      note: "ORIGINAL: Shipping promise = UNKNOWN. REPAIR: Shipping promise structure = GENERATED. Merchant verification = REQUIRED. Not original merchant data.",
    });
  } else {
    items.push({
      field: "shipping_promise",
      existing: product.shippingPromise,
      generated: product.shippingPromise,
      status: "EXISTING",
    });
  }

  // Returns
  if (!product.returnPolicy) {
    items.push({
      field: "return_policy",
      existing: null,
      generated: null,
      status: "UNKNOWN",
      note: "No return policy found in merchant data.",
    });
  } else {
    items.push({
      field: "return_policy",
      existing: product.returnPolicy,
      generated: product.returnPolicy,
      status: "EXISTING",
    });
  }

  // Machine-readable offer
  const machineReadableOffer: Record<string, unknown> = {
    "@type": "Offer",
    productId: product.id,
    name: product.name,
    price: product.price,
    priceCurrency: product.currency,
    availability: product.stock > 0 ? "InStock" : "OutOfStock",
    inventoryLevel: product.stock,
    shipping: product.shippingPromise || null,
    shippingSchema: product.shippingPromise ? undefined : SHIPPING_PROMISE_SCHEMA,
    shippingStatus: product.shippingPromise ? "EXISTING" : "GENERATED",
    merchantVerification: product.shippingPromise ? "NOT_REQUIRED" : "REQUIRED",
    returnPolicy: product.returnPolicy || "UNKNOWN",
    specs: product.specs,
    useCases: product.useCases,
    constraintsSatisfied: true,
  };

  const repair: CommerceRepair = {
    repairId: randomUUID(),
    productId: product.id,
    productName: product.name,
    items,
    machineReadableOffer,
    createdAt: new Date().toISOString(),
    merchantVerification: product.shippingPromise ? "NOT_REQUIRED" : "REQUIRED",
  };

  recordAudit({
    actor: "SYSTEM",
    action: "REPAIR_GENERATED",
    result: "SUCCESS",
    missionId: run.missionId,
    runId: run.runId,
    reason: `Repair generated for ${product.name}`,
    metadata: { repairId: repair.repairId, productId: product.id },
  });

  return repair;
}

/**
 * Overlay repair onto a product for a rerun.
 * GENERATED never becomes product.shippingPromise (that would look like a merchant fact).
 * Only VERIFIED (explicit merchant / demo-synthetic confirmation) may set the promise.
 */
export function applyRepairToProduct(
  product: Product,
  repair: CommerceRepair
): Product {
  const shippingItem = repair.items.find((i) => i.field === "shipping_promise");
  const returnItem = repair.items.find((i) => i.field === "return_policy");

  let shippingPromise = product.shippingPromise;
  let shippingFactStatus: Product["shippingFactStatus"] = product.shippingPromise
    ? "EXISTING"
    : "UNKNOWN";

  if (shippingItem?.status === "GENERATED") {
    shippingPromise = null;
    shippingFactStatus = "GENERATED";
  } else if (shippingItem?.status === "VERIFIED" && shippingItem.generated) {
    shippingPromise = String(shippingItem.generated);
    shippingFactStatus = "VERIFIED";
  }

  return {
    ...product,
    shippingPromise,
    shippingFactStatus,
    returnPolicy:
      returnItem?.status === "GENERATED" && returnItem.generated
        ? String(returnItem.generated)
        : product.returnPolicy,
  };
}

/** DEMO / SYNTHETIC only. Does not claim live merchant data. */
export function simulateMerchantVerification(repair: CommerceRepair): CommerceRepair {
  const items = repair.items.map((item) => {
    if (item.field !== "shipping_promise" || item.status !== "GENERATED") {
      return item;
    }
    return {
      ...item,
      generated: DEMO_SYNTHETIC_SHIPPING_CONFIRMATION,
      status: "VERIFIED" as const,
      note: "DEMO / SYNTHETIC MERCHANT VERIFICATION. Not real merchant data. GENERATED schema was not treated as a merchant promise.",
    };
  });

  const verified: CommerceRepair = {
    ...repair,
    items,
    merchantVerification: "DEMO_SYNTHETIC_VERIFIED",
    machineReadableOffer: {
      ...repair.machineReadableOffer,
      shipping: DEMO_SYNTHETIC_SHIPPING_CONFIRMATION,
      shippingStatus: "VERIFIED",
      merchantVerification: "DEMO_SYNTHETIC_VERIFIED",
      verificationLabel: "DEMO / SYNTHETIC MERCHANT VERIFICATION",
    },
  };

  recordAudit({
    actor: "SYSTEM",
    action: "MERCHANT_VERIFICATION_SIMULATED",
    result: "SUCCESS",
    reason: "DEMO / SYNTHETIC MERCHANT VERIFICATION — not real merchant data",
    metadata: { repairId: repair.repairId, productId: repair.productId },
  });

  return verified;
}
