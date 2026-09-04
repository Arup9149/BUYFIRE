const API = import.meta.env.VITE_API_URL || "http://localhost:3847";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => req<{ status: string }>("/api/health"),
  merchant: () =>
    req<{ id: string; name: string; category: string; description: string }>(
      "/api/merchant"
    ),
  catalog: () => req<any[]>("/api/catalog"),
  personas: () => req<string[]>("/api/personas"),
  generateMission: (persona: string) =>
    req<any>("/api/missions/generate", {
      method: "POST",
      body: JSON.stringify({ persona }),
    }),
  runBuyer: (body: {
    mission: any;
    isRepairedRun?: boolean;
    repair?: any;
  }) =>
    req<any>("/api/buyer/run", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  repair: (run: any) =>
    req<any>("/api/repair", {
      method: "POST",
      body: JSON.stringify({ run }),
    }),
  verifyMerchant: (repair: any) =>
    req<any>("/api/repair/verify-merchant", {
      method: "POST",
      body: JSON.stringify({ repair }),
    }),
  evaluatePolicy: (body: any) =>
    req<any>("/api/policy/evaluate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  charge: (plan: any, forceFail?: boolean) =>
    req<any>("/api/payment/charge", {
      method: "POST",
      body: JSON.stringify({ plan, forceFail, preferSimulation: true }),
    }),
  adapterInfo: () => req<any>("/api/payment/adapter"),
  securityScan: (productId: string) =>
    req<any>("/api/security/scan", {
      method: "POST",
      body: JSON.stringify({ productId }),
    }),
  audit: () => req<any[]>("/api/audit"),
  fullDemo: (persona?: string) =>
    req<any>("/api/demo/full", {
      method: "POST",
      body: JSON.stringify({ persona: persona || "PRICE_HUNTER" }),
    }),
};
