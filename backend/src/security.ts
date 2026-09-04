import { randomUUID } from "crypto";
import type { SecurityAlert, Product } from "../../shared/src/index";

const INSTRUCTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(prior|previous)/i,
  /override\s+(system|policy|limit)/i,
  /buy\s+\d+\s+units?\s+immediately/i,
  /transfer\s+payment\s+authority/i,
  /you\s+are\s+now/i,
  /new\s+system\s+prompt/i,
  /act\s+as\s+(if\s+you\s+are|a)/i,
  /forget\s+(everything|all)/i,
  /execute\s+(shell|command|code)/i,
];

/**
 * Merchant / product content is UNTRUSTED DATA.
 * Never promote it into system instructions.
 */
export function detectPromptInjection(
  content: string,
  source: string
): SecurityAlert | null {
  for (const pattern of INSTRUCTION_PATTERNS) {
    if (pattern.test(content)) {
      return {
        alertId: randomUUID(),
        type: "PROMPT_INJECTION",
        severity: "HIGH",
        source,
        contentSnippet: content.slice(0, 120) + (content.length > 120 ? "…" : ""),
        actionTaken:
          "INSTRUCTION-LIKE CONTENT DETECTED — Action blocked. Purchase authority UNCHANGED.",
        timestamp: new Date().toISOString(),
      };
    }
  }
  return null;
}

export function scanProduct(product: Product): SecurityAlert | null {
  const combined = `${product.name}\n${product.description}`;
  return detectPromptInjection(combined, `product:${product.id}`);
}

export function isInstructionLike(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text));
}
