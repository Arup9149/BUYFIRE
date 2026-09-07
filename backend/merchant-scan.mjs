/**
 * BUYFIRE Merchant Scanner — commercial wedge
 * Does not weaken buyer simulator, policy, or payment security.
 * Semantics: UNKNOWN | GENERATED | VERIFIED (never auto-promote GENERATED → VERIFIED)
 */
import { randomUUID } from "crypto";

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(prior|previous)/i,
  /override\s+(system|policy|limit)/i,
  /buy\s+\d+\s+units?\s+immediately/i,
  /transfer\s+payment\s+authority/i,
  /you\s+are\s+now/i,
  /forget\s+(everything|all)/i,
];

function now() {
  return new Date().toISOString();
}

/**
 * Deterministic scan of a merchant catalog object.
 * @param {object} merchant - { id, name, currency, products[] }
 * @param {object} opts - { source: 'DEMO_CATALOG'|'CSV'|'URL', storeUrl?: string }
 */
export function scanMerchant(merchant, opts = {}) {
  const source = opts.source || "DEMO_CATALOG";
  const scanId = randomUUID();
  const findings = [];
  const evidence = []; // per-field evidence with status

  const products = merchant.products || [];
  let productDataScore = 100;
  let pricingScore = 100;
  let currencyScore = 100;
  let shippingScore = 100;
  let returnsScore = 100;
  let aiSafetyScore = 100;
  let purchasePolicyScore = 100;

  // --- Product Data ---
  if (products.length === 0) {
    findings.push({
      id: "pd-empty",
      category: "Product Data",
      severity: "HIGH",
      title: "No products in catalog",
      detail: "Catalog contains zero products.",
      status: "UNKNOWN",
    });
    productDataScore -= 40;
  }
  for (const p of products) {
    if (!p.specs || p.specs.length === 0) {
      findings.push({
        id: `pd-specs-${p.id}`,
        category: "Product Data",
        severity: "MEDIUM",
        title: "Missing specifications",
        detail: `${p.name}: no structured specs for agent comparison.`,
        productId: p.id,
        status: "UNKNOWN",
      });
      productDataScore = Math.max(0, productDataScore - 5);
      evidence.push({ productId: p.id, field: "specs", status: "UNKNOWN", value: null });
    } else {
      evidence.push({ productId: p.id, field: "specs", status: "VERIFIED", value: p.specs });
    }
    if (!p.useCases || p.useCases.length === 0) {
      findings.push({
        id: `pd-use-${p.id}`,
        category: "Product Data",
        severity: "LOW",
        title: "Missing use cases",
        detail: `${p.name}: agents cannot match mission use-cases.`,
        productId: p.id,
        status: "UNKNOWN",
      });
      productDataScore = Math.max(0, productDataScore - 3);
      evidence.push({ productId: p.id, field: "use_cases", status: "UNKNOWN", value: null });
    } else {
      evidence.push({ productId: p.id, field: "use_cases", status: "VERIFIED", value: p.useCases });
    }
  }

  // --- Pricing ---
  for (const p of products) {
    if (p.price == null || p.price <= 0) {
      findings.push({
        id: `price-${p.id}`,
        category: "Pricing",
        severity: "HIGH",
        title: "Invalid or missing price",
        detail: `${p.name}: price is missing or non-positive.`,
        productId: p.id,
        status: "UNKNOWN",
      });
      pricingScore = Math.max(0, pricingScore - 15);
      evidence.push({ productId: p.id, field: "price", status: "UNKNOWN", value: null });
    } else {
      evidence.push({ productId: p.id, field: "price", status: "VERIFIED", value: p.price });
    }
  }

  // --- Currency ---
  const currencies = new Set(products.map((p) => p.currency).filter(Boolean));
  if (!merchant.currency) {
    findings.push({
      id: "cur-merchant",
      category: "Currency",
      severity: "HIGH",
      title: "Merchant currency not declared",
      detail: "Store-level currency is unknown.",
      status: "UNKNOWN",
    });
    currencyScore -= 20;
  }
  if (currencies.size > 1) {
    findings.push({
      id: "cur-mixed",
      category: "Currency",
      severity: "MEDIUM",
      title: "Mixed currencies in catalog",
      detail: `Found: ${[...currencies].join(", ")}. Agents need a single settlement currency.`,
      status: "UNKNOWN",
    });
    currencyScore -= 15;
  }
  for (const p of products) {
    if (!p.currency) {
      findings.push({
        id: `cur-${p.id}`,
        category: "Currency",
        severity: "HIGH",
        title: "Product currency missing",
        detail: `${p.name}: currency unknown.`,
        productId: p.id,
        status: "UNKNOWN",
      });
      currencyScore = Math.max(0, currencyScore - 10);
      evidence.push({ productId: p.id, field: "currency", status: "UNKNOWN", value: null });
    } else {
      evidence.push({ productId: p.id, field: "currency", status: "VERIFIED", value: p.currency });
    }
  }

  // --- Shipping (critical for AI buyers) ---
  let missingShipping = 0;
  for (const p of products) {
    if (!p.shippingPromise || p.shippingPromise === "UNKNOWN") {
      missingShipping++;
      findings.push({
        id: `ship-${p.id}`,
        category: "Shipping",
        severity: "HIGH",
        title: "Shipping information incomplete",
        detail: `${p.name}: no delivery promise. Autonomous buyers cannot VERIFY checkout.`,
        productId: p.id,
        status: "UNKNOWN",
      });
      evidence.push({ productId: p.id, field: "shipping_promise", status: "UNKNOWN", value: null });
    } else {
      evidence.push({ productId: p.id, field: "shipping_promise", status: "VERIFIED", value: p.shippingPromise });
    }
  }
  if (missingShipping > 0) {
    shippingScore = Math.max(0, 100 - missingShipping * 18);
  }
  // Geographic availability never invented
  findings.push({
    id: "geo-avail",
    category: "Shipping",
    severity: "MEDIUM",
    title: "Missing geographic availability",
    detail: "No ship-to regions declared. Agents cannot confirm delivery geography.",
    status: "UNKNOWN",
  });
  shippingScore = Math.max(0, shippingScore - 10);
  evidence.push({ productId: null, field: "geographic_availability", status: "UNKNOWN", value: null });

  // --- Returns ---
  let missingReturns = 0;
  for (const p of products) {
    if (!p.returnPolicy) {
      missingReturns++;
      findings.push({
        id: `ret-${p.id}`,
        category: "Returns",
        severity: "MEDIUM",
        title: "Return policy ambiguous or missing",
        detail: `${p.name}: return policy unknown.`,
        productId: p.id,
        status: "UNKNOWN",
      });
      evidence.push({ productId: p.id, field: "return_policy", status: "UNKNOWN", value: null });
    } else {
      evidence.push({ productId: p.id, field: "return_policy", status: "VERIFIED", value: p.returnPolicy });
    }
  }
  if (missingReturns > 0) returnsScore = Math.max(0, 100 - missingReturns * 12);

  // --- AI Safety ---
  for (const p of products) {
    const text = `${p.name || ""}\n${p.description || ""}`;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        findings.push({
          id: `inj-${p.id}`,
          category: "AI Safety",
          severity: "HIGH",
          title: "Potential instruction injection",
          detail: `${p.name}: product content contains instruction-like language that could manipulate agents.`,
          productId: p.id,
          status: "UNKNOWN",
        });
        aiSafetyScore = Math.max(0, aiSafetyScore - 25);
        break;
      }
    }
  }
  if (!findings.some((f) => f.category === "AI Safety")) {
    // still note merchant verification
  }
  findings.push({
    id: "merch-verify",
    category: "AI Safety",
    severity: "MEDIUM",
    title: "Missing merchant verification",
    detail: "No verified merchant identity attestation for agent trust.",
    status: "UNKNOWN",
  });
  aiSafetyScore = Math.max(0, aiSafetyScore - 10);

  // --- Purchase Policy ---
  findings.push({
    id: "pol-limits",
    category: "Purchase Policy",
    severity: "LOW",
    title: "Agent purchase limits not published",
    detail: "Store does not expose max transaction amount or allowed agent constraints for autonomous buyers.",
    status: "UNKNOWN",
  });
  purchasePolicyScore = Math.max(0, purchasePolicyScore - 15);
  findings.push({
    id: "pol-idem",
    category: "Purchase Policy",
    severity: "LOW",
    title: "Idempotency contract not documented",
    detail: "No machine-readable idempotency guidance for agent retries.",
    status: "UNKNOWN",
  });
  purchasePolicyScore = Math.max(0, purchasePolicyScore - 10);

  // Weighted overall score (deterministic)
  const overall = Math.round(
    productDataScore * 0.15 +
      pricingScore * 0.15 +
      currencyScore * 0.1 +
      shippingScore * 0.25 +
      returnsScore * 0.1 +
      aiSafetyScore * 0.15 +
      purchasePolicyScore * 0.1
  );

  const categories = {
    "Product Data": productDataScore,
    Pricing: pricingScore,
    Currency: currencyScore,
    Shipping: shippingScore,
    Returns: returnsScore,
    "AI Safety": aiSafetyScore,
    "Purchase Policy": purchasePolicyScore,
  };

  const highCount = findings.filter((f) => f.severity === "HIGH").length;
  const medCount = findings.filter((f) => f.severity === "MEDIUM").length;

  return {
    scanId,
    timestamp: now(),
    source,
    sourceLabel: source === "DEMO_CATALOG" ? "DEMO CATALOG" : source === "CSV" ? "CSV UPLOAD" : "URL (limited)",
    isDemo: source === "DEMO_CATALOG",
    storeUrl: opts.storeUrl || null,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      currency: merchant.currency,
      productCount: products.length,
    },
    readiness: {
      score: overall,
      maxScore: 100,
      label: overall >= 80 ? "Strong" : overall >= 60 ? "Needs work" : "Not AI-commerce ready",
      categories,
    },
    findings,
    evidence,
    summary: {
      issueCount: findings.length,
      high: highCount,
      medium: medCount,
      low: findings.length - highCount - medCount,
      unknownFields: evidence.filter((e) => e.status === "UNKNOWN").length,
      verifiedFields: evidence.filter((e) => e.status === "VERIFIED").length,
      generatedFields: evidence.filter((e) => e.status === "GENERATED").length,
    },
  };
}

/**
 * Generate machine-readable repairs for UNKNOWN evidence.
 * Status becomes GENERATED — never VERIFIED.
 * Does NOT invent delivery dates, carriers, guarantees, costs, or geo.
 */
export function generateMerchantRepairs(scanResult, merchant) {
  const repairs = [];
  const products = merchant.products || [];

  for (const ev of scanResult.evidence || []) {
    if (ev.status !== "UNKNOWN") continue;

    if (ev.field === "shipping_promise" && ev.productId) {
      const p = products.find((x) => x.id === ev.productId);
      repairs.push({
        repairId: randomUUID(),
        productId: ev.productId,
        productName: p?.name || ev.productId,
        field: "shipping_promise",
        existing: null,
        generated:
          "STRUCTURE ONLY: Declare a shipping_promise string (e.g. window + method). BUYFIRE does not invent carrier, cost, date, or guarantee.",
        status: "GENERATED",
        note: "GENERATED — NOT VERIFIED. Merchant must confirm actual shipping terms before this can become VERIFIED.",
        cannotAuthorizePurchase: true,
      });
    }

    if (ev.field === "return_policy" && ev.productId) {
      const p = products.find((x) => x.id === ev.productId);
      repairs.push({
        repairId: randomUUID(),
        productId: ev.productId,
        productName: p?.name || ev.productId,
        field: "return_policy",
        existing: null,
        generated:
          "STRUCTURE ONLY: Provide return window and conditions as merchant text. Not verified.",
        status: "GENERATED",
        note: "GENERATED — NOT VERIFIED. Merchant verification required.",
        cannotAuthorizePurchase: true,
      });
    }

    if (ev.field === "geographic_availability") {
      repairs.push({
        repairId: randomUUID(),
        productId: null,
        productName: null,
        field: "geographic_availability",
        existing: null,
        generated:
          "STRUCTURE ONLY: List ship-to regions/countries the merchant actually serves. BUYFIRE never invents geography.",
        status: "GENERATED",
        note: "GENERATED — NOT VERIFIED.",
        cannotAuthorizePurchase: true,
      });
    }
  }

  // Update evidence copies for response (GENERATED overlay — does not mutate scan VERIFIED)
  const evidence = (scanResult.evidence || []).map((ev) => {
    const r = repairs.find(
      (x) => x.field === ev.field && x.productId === ev.productId
    );
    if (r && ev.status === "UNKNOWN") {
      return {
        ...ev,
        status: "GENERATED",
        value: r.generated,
        note: r.note,
        cannotAuthorizePurchase: true,
      };
    }
    return { ...ev };
  });

  return {
    repairBatchId: randomUUID(),
    scanId: scanResult.scanId,
    timestamp: now(),
    repairs,
    evidence,
    warning:
      "All GENERATED fields are NOT VERIFIED and cannot authorize purchase until merchant confirmation.",
  };
}

/**
 * Merchant verifies a GENERATED field → VERIFIED.
 * Only explicit merchant confirmation promotes status.
 */
export function verifyMerchantField(repairBatch, field, productId, confirmedValue) {
  if (!confirmedValue || String(confirmedValue).trim() === "") {
    return { ok: false, error: "Merchant must supply a real confirmed value. Empty values rejected." };
  }
  // Block inventing critical shipping guarantees via vague confirmation
  const forbidden = /guaranteed\s+(same|next)\s+day|free\s+worldwide|we\s+invented/i;
  if (field === "shipping_promise" && forbidden.test(confirmedValue)) {
    return {
      ok: false,
      error: "Confirmation rejected: value appears to invent an unsupported guarantee. Provide actual merchant policy text.",
    };
  }

  const evidence = (repairBatch.evidence || []).map((ev) => {
    if (ev.field === field && (ev.productId || null) === (productId || null)) {
      if (ev.status !== "GENERATED" && ev.status !== "UNKNOWN") {
        return ev;
      }
      return {
        ...ev,
        status: "VERIFIED",
        value: String(confirmedValue).trim(),
        note: "Merchant-confirmed.",
        cannotAuthorizePurchase: false,
      };
    }
    return ev;
  });

  return {
    ok: true,
    timestamp: now(),
    field,
    productId: productId || null,
    status: "VERIFIED",
    evidence,
  };
}

/**
 * Policy gate: GENERATED evidence must not authorize purchase for that product field.
 */
export function generatedBlocksPurchase(evidence, productIds) {
  const ids = new Set(productIds || []);
  const blockers = (evidence || []).filter(
    (e) =>
      e.status === "GENERATED" &&
      e.cannotAuthorizePurchase &&
      (e.productId == null || ids.has(e.productId)) &&
      (e.field === "shipping_promise" || e.field === "price" || e.field === "currency")
  );
  return {
    blocked: blockers.length > 0,
    blockers,
    reason:
      blockers.length > 0
        ? "GENERATED evidence cannot authorize purchase. Merchant verification required for: " +
          blockers.map((b) => b.field).join(", ")
        : null,
  };
}

export function parseProductCsv(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { error: "CSV must include header + at least one row" };
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const products = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx];
    });
    products.push({
      id: row.id || `csv_${i}`,
      name: row.name || `Product ${i}`,
      description: row.description || "",
      price: Number(row.price) || 0,
      currency: row.currency || "INR",
      stock: Number(row.stock) || 0,
      category: row.category || "General",
      specs: row.specs
        ? String(row.specs)
            .split("|")
            .map((s) => {
              const [key, value] = s.split(":");
              return { key: key || "spec", value: value || s };
            })
        : [],
      useCases: row.usecases ? String(row.usecases).split("|") : [],
      shippingPromise: row.shipping || row.shipping_promise || null,
      returnPolicy: row.returns || row.return_policy || null,
    });
  }
  return {
    merchant: {
      id: "merchant_csv_upload",
      name: "CSV Upload Catalog",
      category: "UPLOADED",
      description: "Catalog parsed from merchant CSV.",
      currency: products[0]?.currency || "INR",
      products,
    },
  };
}
