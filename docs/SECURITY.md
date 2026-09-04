# BUYFIRE Security

## Trust boundaries

| Zone | Trust |
|------|-------|
| Merchant product name/description | **Untrusted** |
| Mission constraints from UI | Trusted structured input |
| Policy engine constants | Trusted (code) |
| Payment adapter credentials | Server-only secrets |
| Frontend | No secrets, no payment authority |

## Prompt injection

Merchant content is scanned with instruction-like patterns before any agent action on that product.

Detected patterns include (non-exhaustive):

- "ignore previous instructions"
- "buy N units immediately"
- "transfer payment authority"
- "override ... limit"

**Expected demo behavior**

```
⚠ INSTRUCTION-LIKE CONTENT DETECTED
Action blocked.
Reason: Merchant content attempted to modify agent behavior.
Purchase authority: UNCHANGED
```

An audit event is recorded. Automated tests cover the malicious product.

## Payment authority

```
AI output → Intent → Policy → PurchasePlan → Adapter
```

The model cannot:

- Set amount above `MAX_TRANSACTION_AMOUNT`
- Change currency outside allow-list
- Target disallowed merchants
- Supply credentials
- Force retries on failure
- Execute shell / arbitrary HTTP

## Secrets

- Never log API keys, tokens, card data
- Audit metadata filter strips keys matching `/key|secret|token|password|card|cvv|auth/i`
- Razorpay keys only via `process.env`, never sent to frontend

## Failure handling

Payment decline → classify → **stop** → audit. No blind retry loop.

## SSRF / arbitrary URLs

Model output is not used to construct outbound HTTP targets in this demo. Payment adapters use fixed endpoints only when credentials exist.

## Idempotency

Every purchase plan carries an `idempotencyKey` derived from run + products + amount.
