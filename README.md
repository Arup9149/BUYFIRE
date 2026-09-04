# BUYFIRE

**Attack your store with AI buyers before real AI buyers do.**

BUYFIRE launches synthetic AI buyers against a merchant catalog and walks:

`DISCOVER → UNDERSTAND → COMPARE → VERIFY → CART → CHECKOUT`

It finds where autonomous purchase fails, generates a machine-readable commerce repair, reruns the **same** mission, and demonstrates a safe simulated checkout.

> **Central question: Can an AI actually buy from your store?**

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
