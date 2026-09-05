# BUYFIRE

## The AI Commerce Agent That Knows When It Doesn't Know.

BUYFIRE is a security-first AI commerce agent that can reason about a purchase without turning missing information into fabricated merchant facts.

AI can decide what it wants to buy. BUYFIRE decides whether it has enough verified evidence to safely proceed.

### The core loop

UNKNOWN
↓
GENERATED REPAIR
↓
MERCHANT VERIFICATION
↓
VERIFIED
↓
DETERMINISTIC POLICY
↓
CHECKOUT

### The problem

Autonomous commerce agents can encounter incomplete or untrusted merchant data.

The dangerous failure is not simply an AI making a bad recommendation.

It is an AI silently filling in missing commerce facts and then using those invented facts to justify a purchase.

BUYFIRE is designed around the opposite principle:

> If the merchant did not provide the fact, BUYFIRE does not invent it.

### What makes BUYFIRE different

BUYFIRE separates AI reasoning from purchase authorization.

When critical information is missing:

1. BUYFIRE detects the missing fact.
2. The repair engine generates a machine-readable repair structure.
3. The repair remains explicitly UNVERIFIED.
4. Merchant verification is required.
5. Only VERIFIED information can unblock the purchase.
6. A deterministic policy engine independently validates the purchase before checkout.

Generated information is never silently converted into merchant truth.

### The live demo

Buyer mission:

"I need the best laptop for CAD work under ₹80,000."

The merchant catalog is missing a shipping promise.

BUYFIRE:

PURCHASE BLOCKED

Reason:
SHIPPING PROMISE UNKNOWN

Then:

GENERATED REPAIR
NOT VERIFIED

Then:

DEMO / SYNTHETIC MERCHANT VERIFICATION

Then:

VERIFIED

Then the SAME mission is rerun:

COMPLETE — ₹74,990

The payment layer is explicitly simulated:

SIMULATION — NO REAL MONEY MOVED

### Security boundary

The model/content layer never receives payment authority.

Purchase authorization is enforced separately through deterministic checks for:

- amount
- currency
- merchant
- product
- idempotency
- approved purchase plan

BUYFIRE also demonstrates:

- prompt-injection blocking
- payment-plan tamper resistance
- no blind retry after payment failure
- audit logging
- secret stripping

### Why this matters

The central question is not:

"Can an AI click Buy?"

It is:

"Can an autonomous commerce system know the difference between what it knows, what it generated, and what the merchant actually confirmed?"

BUYFIRE makes that boundary explicit.

---

## Quick Start (verified)

Zero external npm packages required for the backend demo path.

```bash
cd BUYFIRE/backend
node server.mjs
```

Open:

- **UI:** http://localhost:3847/
- **API health:** http://localhost:3847/api/health

Run API tests (server must be running):

```bash
cd backend
node test-api.mjs
```

### Optional React frontend

If npm registry is available:

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173  (set VITE_API_URL=http://localhost:3847)
```

## Architecture

- **backend/server.mjs** — pure Node HTTP server (no Express dependency for demo)
- **backend/src/** — TypeScript modules (catalog, buyer, policy, repair, payments, security, audit)
- **frontend/** — React + Vite UI (same flow)
- **demo.html** — standalone UI served by the backend

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security model

Merchant product text is **untrusted**. Instruction-like content is detected and blocked; purchase authority is unchanged. Policy engine enforces amount, currency, merchant, product presence, expiration, and idempotency. Payment secrets never reach the frontend. Audit strips secret-like keys.

See [docs/SECURITY.md](docs/SECURITY.md).

## Demo flow

1. Open UI → **RUN A BUYER**
2. Mission: CAD laptop under ₹80,000
3. State machine **BLOCKED** (SHIPPING PROMISE UNKNOWN)
4. **GENERATE REPAIR** → shipping structure **GENERATED** (not a merchant fact)
5. **SIMULATE MERCHANT VERIFICATION** (DEMO / SYNTHETIC) → **VERIFIED**
6. **RERUN SAME MISSION** → COMPLETE (₹74,990)
6. **Checkout** → policy APPROVED + **SIMULATION — NO REAL MONEY MOVED**
7. **Payment failure** → DECLINED, no blind retry
8. **Security attack** → injection blocked
9. **Audit trail**

Full script: [docs/DEMO.md](docs/DEMO.md)

## Payment modes

| Adapter | When | Label |
|---------|------|-------|
| DemoSimulationAdapter | Default (no Razorpay keys) | SIMULATION — NO REAL MONEY MOVED |
| RazorpayTestAdapter | Only if `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` set | Never fabricates success in this build |

## Testing

```bash
# With server running on :3847
cd backend && node test-api.mjs
```

Covers: health, mission, blocked run, repair, complete rerun, policy limits, currency rejection, simulation payment, payment failure, prompt injection, audit secret stripping.

## Known limitations

- Demo merchant only (ForgeWorks Station)
- In-memory audit (clears on restart)
- No production auth / multi-tenant
- npm installs in constrained environments may fail (502/EIO); pure Node server avoids that
- Razorpay not live-tested without credentials
- Not affiliated with or endorsed by Razorpay
