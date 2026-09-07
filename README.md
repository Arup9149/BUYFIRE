# BUYFIRE — The Trust Layer for AI Commerce

**Know whether an AI agent can safely buy from your store — before it tries.**

## Who pays
Merchants buy the **BUYFIRE Merchant Audit (₹2,999)** after a free public scan. Lead capture only in this build — **no real money is moved** unless you later connect Razorpay/Stripe.

## Quick start
```bash
cd backend
node server.mjs
# open http://localhost:3847/
node ./test-api.mjs
```

## Product
1. **SCAN MY STORE** — public URL scanner (SSRF-safe, no JS execution)
2. **SIMULATE AI BUYER** — deterministic buyer: UNKNOWN shipping → BLOCKED → GENERATED ≠ purchase authority → VERIFIED → COMPLETE → SIMULATED payment
3. **Request Audit (₹2,999)** — email + store URL + optional name → durable JSONL lead + request ID

## Scanner methodology
- Validate URL (http/https only; block localhost, private IPs, credentials, file/javascript)
- Fetch homepage + common commerce/policy paths (bounded)
- Discover product links from HTML; try `sitemap.xml` / indexes
- Fetch bounded product pages; parse JSON-LD Product/Offer + reliable meta
- Classifications: **READY / PARTIAL / SCAN WEAK / INCOMPLETE**
- Missing facts stay **UNKNOWN**; repairs are **GENERATED** until merchant **VERIFIED**
- Blocked sites get recovery path: CSV / product URLs / paid audit

## Security model
Deterministic policy, server-side plans, injection blocking, audit redaction, payment simulation labels, no blind retry, SSRF protections on outbound fetch.

## API (selected)
- `POST /api/merchant/scan` `{ url }` | `{ demo: true }` | `{ csvText }`
- `POST /api/merchant/audit-request` `{ email, storeUrl, storeName?, scannerScore?, classification? }`
- `GET /api/merchant/leads`
- Existing buyer: `/api/missions/generate`, `/api/buyer/run`, `/api/repair`, `/api/policy/evaluate`, `/api/payment/charge`

## Known limitations
- HTML-only (no headless browser); JS-heavy catalogs may be SCAN WEAK
- 403/429 → INCOMPLETE
- Leads in `backend/data/audit-leads.jsonl` (local)
- No live Razorpay capture unless you configure and implement the adapter later


## Prior docs
See `docs/` for architecture, security, and demo script.
