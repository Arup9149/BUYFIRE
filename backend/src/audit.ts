import { randomUUID } from "crypto";
import type { AuditEvent, AuditActor, Currency } from "../../shared/src/index";

const store: AuditEvent[] = [];

export function recordAudit(params: {
  actor: AuditActor;
  action: string;
  result: AuditEvent["result"];
  missionId?: string;
  runId?: string;
  intent?: string;
  decision?: string;
  amount?: number;
  currency?: Currency;
  reason?: string;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  // Never log secrets / keys / tokens / card data
  const safeMeta = params.metadata
    ? Object.fromEntries(
        Object.entries(params.metadata).filter(
          ([k]) =>
            !/key|secret|token|password|card|cvv|auth/i.test(k)
        )
      )
    : undefined;

  const event: AuditEvent = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: params.actor,
    missionId: params.missionId,
    runId: params.runId,
    intent: params.intent,
    decision: params.decision,
    amount: params.amount,
    currency: params.currency,
    action: params.action,
    result: params.result,
    reason: params.reason,
    metadata: safeMeta,
  };
  store.push(event);
  return event;
}

export function getAuditEvents(): AuditEvent[] {
  return [...store].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function clearAudit(): void {
  store.length = 0;
}
