# BUYFIRE Architecture

## Overview

Monolithic vertical slice optimized for a one-day demo.

```
AI BUYER
   ↓
INTENT / MISSION (structured constraints)
   ↓
DETERMINISTIC BUYER STATE MACHINE
   ↓
POLICY ENGINE (limits, currency, merchant, idempotency)
   ↓
AUTHORIZATION GATE (plan.approved)
   ↓
PAYMENT ADAPTER (Simulation | Razorpay Test)
   ↓
AUDIT EVENT
```

LLM / agent output **never** directly controls payment authority.

## Modules (backend)

| Module | Role |
|--------|------|
| `catalog.ts` | Demo merchant + products with deliberate data gaps |
| `missions.ts` | Persona → mission generator from catalog |
| `buyer.ts` | Deterministic state machine + evidence |
| `repair.ts` | Machine-readable commerce repair (no hallucination of facts) |
| `policy.ts` | Hard limits: amount, currency, merchant, expiry, idempotency |
| `payments.ts` | Adapter interface + DemoSimulation + RazorpayTest skeleton |
| `security.ts` | Prompt-injection detection on untrusted merchant content |
| `audit.ts` | Append-only events; strips secrets from metadata |

## State machine

`DISCOVER → UNDERSTAND → COMPARE → VERIFY → CART → CHECKOUT → COMPLETE | BLOCKED`

Every transition emits structured evidence (match / mismatch / unknown / blocked). No hidden chain-of-thought is exposed.

## Trust boundaries

1. **Merchant catalog content** = untrusted data
2. **Mission constraints** = trusted structured input
3. **Policy limits** = code-defined, not model-overridable
4. **Payment secrets** = server env only

## Frontend screens

Landing · Mission Lab · Live Run · Crash Report · Repair · Before/After · Payment · Security · Audit

## Data flow (happy path after repair)

1. Generate mission (PRICE_HUNTER)
2. Run buyer → BLOCKED (missing shipping)
3. Generate repair → shipping GENERATED
4. Rerun same mission → COMPLETE
5. Evaluate policy → APPROVED
6. Charge via simulation adapter
7. Audit events for each step
