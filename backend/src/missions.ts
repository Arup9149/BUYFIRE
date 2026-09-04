import { randomUUID } from "crypto";
import type { BuyerMission, BuyerPersona, Merchant } from "../../shared/src/index";
import { DEMO_MERCHANT } from "./catalog";

const PERSONA_TEMPLATES: Record<
  BuyerPersona,
  (merchant: Merchant) => BuyerMission
> = {
  PRICE_HUNTER: (merchant) => ({
    id: randomUUID(),
    persona: "PRICE_HUNTER",
    statement: "I need the best laptop for CAD work under ₹80,000.",
    constraints: [
      { type: "max_price", value: 80000, label: "Max price ₹80,000" },
      { type: "use_case", value: "CAD", label: "Use case: CAD" },
      { type: "category", value: "Laptop", label: "Category: Laptop" },
    ],
    targetCategory: "Laptop",
    maxAmount: 80000,
    currency: merchant.currency,
    createdAt: new Date().toISOString(),
  }),

  SPECIFICATION_BUYER: (merchant) => ({
    id: randomUUID(),
    persona: "SPECIFICATION_BUYER",
    statement:
      "I need a laptop with at least 32GB RAM and a discrete GPU for CAD under ₹90,000.",
    constraints: [
      { type: "max_price", value: 90000, label: "Max price ₹90,000" },
      { type: "spec", value: "ram>=32", label: "RAM ≥ 32GB" },
      { type: "spec", value: "gpu=discrete", label: "Discrete GPU required" },
      { type: "use_case", value: "CAD", label: "Use case: CAD" },
    ],
    targetCategory: "Laptop",
    maxAmount: 90000,
    currency: merchant.currency,
    createdAt: new Date().toISOString(),
  }),

  URGENT_BUYER: (merchant) => ({
    id: randomUUID(),
    persona: "URGENT_BUYER",
    statement:
      "I need a laptop for CAD under ₹80,000 and it must arrive within 3 days.",
    constraints: [
      { type: "max_price", value: 80000, label: "Max price ₹80,000" },
      { type: "delivery_days", value: 3, label: "Delivery within 3 days" },
      { type: "use_case", value: "CAD", label: "Use case: CAD" },
    ],
    targetCategory: "Laptop",
    maxAmount: 80000,
    currency: merchant.currency,
    createdAt: new Date().toISOString(),
  }),

  BUNDLE_BUYER: (merchant) => ({
    id: randomUUID(),
    persona: "BUNDLE_BUYER",
    statement: "I need everything required for a home office under ₹25,000.",
    constraints: [
      { type: "max_price", value: 25000, label: "Max total ₹25,000" },
      { type: "use_case", value: "home office", label: "Use case: home office" },
    ],
    targetCategory: undefined,
    maxAmount: 25000,
    currency: merchant.currency,
    createdAt: new Date().toISOString(),
  }),

  CONSTRAINT_BUYER: (merchant) => ({
    id: randomUUID(),
    persona: "CONSTRAINT_BUYER",
    statement:
      "I need running shoes for half-marathon training under ₹8,000.",
    constraints: [
      { type: "max_price", value: 8000, label: "Max price ₹8,000" },
      { type: "use_case", value: "half-marathon", label: "Use case: half-marathon" },
      { type: "category", value: "Footwear", label: "Category: Footwear" },
    ],
    targetCategory: "Footwear",
    maxAmount: 8000,
    currency: merchant.currency,
    createdAt: new Date().toISOString(),
  }),
};

export function generateMission(
  persona: BuyerPersona = "PRICE_HUNTER",
  merchant: Merchant = DEMO_MERCHANT
): BuyerMission {
  const factory = PERSONA_TEMPLATES[persona];
  if (!factory) throw new Error(`Unknown persona: ${persona}`);
  return factory(merchant);
}

export function listPersonas(): BuyerPersona[] {
  return Object.keys(PERSONA_TEMPLATES) as BuyerPersona[];
}
