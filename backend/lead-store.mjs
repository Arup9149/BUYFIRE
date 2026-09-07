/**
 * Durable merchant audit lead store (JSONL). No card data, no secrets.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const LEADS_FILE = join(DATA_DIR, "audit-leads.jsonl");

function ensure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(LEADS_FILE)) appendFileSync(LEADS_FILE, "", "utf8");
}

export function createLead(input) {
  ensure();
  const email = String(input.email || "").trim().toLowerCase();
  const storeUrl = String(input.storeUrl || input.url || "").trim();
  const storeName = input.storeName ? String(input.storeName).trim().slice(0, 200) : null;
  if (!storeUrl) return { ok: false, error: "storeUrl required" };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Valid merchant email required" };
  }

  const requestId = randomUUID();
  const record = {
    requestId,
    timestamp: new Date().toISOString(),
    email,
    emailDomain: email.split("@")[1] || "unknown",
    storeUrl,
    storeName,
    scannerScore: input.scannerScore != null ? Number(input.scannerScore) : null,
    classification: input.classification || null,
    scanId: input.scanId || null,
    source: input.source || null,
    note: "BUYFIRE Merchant Audit lead — ₹2,999 — no payment processed in this build",
  };

  // Sensible dedupe: same email+url within 24h still records new requestId but flags duplicate
  let duplicateOf = null;
  try {
    const lines = readFileSync(LEADS_FILE, "utf8").split("\n").filter(Boolean);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
      try {
        const row = JSON.parse(lines[i]);
        if (
          row.email === email &&
          row.storeUrl === storeUrl &&
          new Date(row.timestamp).getTime() > dayAgo
        ) {
          duplicateOf = row.requestId;
          break;
        }
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    /* first write */
  }

  if (duplicateOf) record.duplicateOf = duplicateOf;

  appendFileSync(LEADS_FILE, JSON.stringify(record) + "\n", "utf8");
  return {
    ok: true,
    received: true,
    requestId,
    message: "Audit request received. BUYFIRE will prepare your merchant readiness audit.",
    storeUrl,
    email,
    storeName,
    duplicateOf,
    note: "Lead-generation only. No payment was processed. Connect Razorpay/Stripe later without changing this product flow.",
  };
}

export function listLeads(limit = 50) {
  ensure();
  const lines = readFileSync(LEADS_FILE, "utf8").split("\n").filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function leadsFilePath() {
  return LEADS_FILE;
}
