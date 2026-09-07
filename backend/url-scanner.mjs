/**
 * BUYFIRE public URL scanner V1.1 — commercial product discovery
 * SSRF-hardened, no JS execution, no fabricated evidence.
 */
import { lookup } from "dns/promises";
import { isIP } from "net";
import { randomUUID } from "crypto";

const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 12;
const MAX_PRODUCT_PAGES = 8;
const MAX_SITEMAP_URLS = 40;

const PATH_CANDIDATES = [
  "",
  "/products",
  "/collections",
  "/collections/all",
  "/shop",
  "/catalog",
  "/shipping",
  "/delivery",
  "/returns",
  "/refund",
  "/policies",
  "/pages/shipping-policy",
  "/pages/refund-policy",
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(prior|previous)/i,
  /override\s+(system|policy|limit|authority)/i,
  /buy\s+\d+\s+units?\s+immediately/i,
  /transfer\s+payment\s+authority/i,
  /you\s+are\s+now/i,
  /new\s+system\s+prompt/i,
  /forget\s+(everything|all)/i,
];

function now() {
  return new Date().toISOString();
}

function isPrivateIp(ip) {
  if (!ip) return true;
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "127.0.0.1" || v === "::1" || v === "0.0.0.0") return true;
  if (v.startsWith("10.")) return true;
  if (v.startsWith("192.168.")) return true;
  if (v.startsWith("169.254.")) return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  const m = /^172\.(\d+)\./.exec(v);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (v.startsWith("100.")) {
    const parts = v.split(".").map(Number);
    if (parts[1] >= 64 && parts[1] <= 127) return true;
  }
  return false;
}

export async function validatePublicUrl(raw) {
  if (!raw || typeof raw !== "string") return { ok: false, error: "URL is required" };
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https protocols are allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed" };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return { ok: false, error: "localhost and local hostnames are not allowed" };
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, error: "Private or internal IP addresses are not allowed" };
  } else {
    try {
      const records = await lookup(host, { all: true });
      for (const r of records) {
        if (isPrivateIp(r.address)) {
          return { ok: false, error: "Hostname resolves to a private/internal IP (SSRF blocked)" };
        }
      }
    } catch (e) {
      return { ok: false, error: "DNS resolution failed: " + (e.message || "unknown") };
    }
  }
  const origin = parsed.origin;
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return { ok: true, url: origin + path, origin, host };
}

async function fetchText(url, opts = {}) {
  const timeout = opts.timeoutMs || FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "BUYFIRE-Scanner/1.1 (+public-readiness-scan)",
        Accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.8",
      },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: "Redirect without location", status: res.status };
      const next = new URL(loc, url).href;
      const hops = (opts._hops || 0) + 1;
      if (hops > MAX_REDIRECTS) return { ok: false, error: "Too many redirects", status: res.status };
      const v = await validatePublicUrl(next);
      if (!v.ok) return { ok: false, error: "Redirect blocked: " + v.error, status: res.status };
      return fetchText(next, { ...opts, _hops: hops });
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    const text =
      buf.length > MAX_RESPONSE_BYTES
        ? buf.subarray(0, MAX_RESPONSE_BYTES).toString("utf8")
        : buf.toString("utf8");
    return {
      ok: true,
      truncated: buf.length > MAX_RESPONSE_BYTES,
      text,
      finalUrl: url,
      status: res.status,
      contentType: ctype,
    };
  } catch (e) {
    if (e.name === "AbortError") return { ok: false, error: "Fetch timeout after " + timeout + "ms" };
    return { ok: false, error: e.message || "Fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const json = JSON.parse(m[1].trim());
      if (Array.isArray(json)) blocks.push(...json);
      else blocks.push(json);
    } catch {
      /* ignore */
    }
  }
  return blocks;
}

function walkJsonLd(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => walkJsonLd(n, out));
    return out;
  }
  const type = node["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => /Product|Offer|AggregateOffer/i.test(String(t)))) out.push(node);
  if (node["@graph"]) walkJsonLd(node["@graph"], out);
  Object.values(node).forEach((v) => {
    if (v && typeof v === "object") walkJsonLd(v, out);
  });
  return out;
}

/** Same-origin product/collection link extraction */
export function extractProductLinks(html, origin) {
  const links = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const u = new URL(href, origin);
      if (u.origin !== origin) continue;
      const path = u.pathname;
      if (
        /\/products?\//i.test(path) ||
        /\/product\//i.test(path) ||
        /\/p\//i.test(path) ||
        /\/dp\//i.test(path) ||
        /\/collections\/[^/]+\/products\//i.test(path) ||
        /\/item\//i.test(path) ||
        /\/shop\/[^/]+$/i.test(path)
      ) {
        links.add(u.origin + u.pathname);
      }
    } catch {
      /* skip */
    }
  }
  return [...links];
}

export function extractSitemapUrls(xmlText, origin) {
  const urls = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xmlText))) {
    const loc = m[1].trim();
    try {
      const u = new URL(loc);
      if (origin && u.origin !== origin) continue;
      urls.push(u.href);
    } catch {
      /* skip */
    }
  }
  return urls;
}

function isProductUrl(url) {
  try {
    const p = new URL(url).pathname;
    return (
      /\/products?\//i.test(p) ||
      /\/product\//i.test(p) ||
      /\/collections\/[^/]+\/products\//i.test(p) ||
      /\/p\//i.test(p) ||
      /\/item\//i.test(p)
    );
  } catch {
    return false;
  }
}

function isSitemapIndex(xml) {
  return /<sitemapindex/i.test(xml);
}

/**
 * Extract evidence from HTML without inventing facts.
 */
export function extractEvidenceFromHtml(html, pageUrl = "") {
  const text = stripTags(html);
  const lower = text.toLowerCase();
  const jsonLd = extractJsonLd(html);
  const productNodes = walkJsonLd(jsonLd);

  const observed = {
    products: [],
    currencies: new Set(),
    prices: [],
    hasShippingText: false,
    hasReturnsText: false,
    shippingSnippets: [],
    returnsSnippets: [],
    injectionHits: [],
    openGraph: {},
    merchantName: null,
  };

  const ogTitle =
    html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const ogType =
    html.match(/property=["']og:type["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:type["']/i);
  const ogSite =
    html.match(/property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
  if (ogTitle) observed.openGraph.title = ogTitle[1];
  if (ogType) observed.openGraph.type = ogType[1];
  if (ogSite) {
    observed.openGraph.site_name = ogSite[1];
    observed.merchantName = ogSite[1];
  }

  for (const p of productNodes) {
    const name = p.name || p.title || null;
    const offers = p.offers || p.offer || null;
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
    let price = p.price != null ? p.price : null;
    let currency = p.priceCurrency || null;
    let availability = null;
    for (const o of offerList) {
      if (o && o.price != null) price = o.price;
      if (o && o.priceCurrency) currency = o.priceCurrency;
      if (o && o.availability) availability = String(o.availability);
    }
    if (currency) observed.currencies.add(String(currency));
    if (price != null) observed.prices.push(Number(price) || price);
    observed.products.push({
      name: name || "Unnamed product",
      price: price != null ? Number(price) || price : null,
      currency: currency || null,
      availability,
      source: "JSON-LD",
      pageUrl,
    });
  }

  // Shopify-style meta / itemprop fallbacks (only if present)
  const itemPrice = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
  const itemCur = html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)["']/i);
  if (itemCur) observed.currencies.add(itemCur[1]);
  if (itemPrice) observed.prices.push(Number(itemPrice[1]) || itemPrice[1]);

  const metaCurrency = html.match(/property=["']product:price:currency["'][^>]*content=["']([^"']+)["']/i);
  if (metaCurrency) observed.currencies.add(metaCurrency[1]);
  const metaPrice = html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i);
  if (metaPrice) observed.prices.push(Number(metaPrice[1]) || metaPrice[1]);

  // Shopify product JSON in script tags (common pattern, still data not JS exec)
  const shopifyMatch = html.match(/<script[^>]*type=["']application\/json["'][^>]*data-product-json[^>]*>([\s\S]*?)<\/script>/i)
    || html.match(/Shopify\.analytics\s*=\s*\{[\s\S]*?currency:\s*["']([A-Z]{3})["']/i);
  if (shopifyMatch && shopifyMatch[1] && /^[A-Z]{3}$/.test(shopifyMatch[1])) {
    observed.currencies.add(shopifyMatch[1]);
  }

  const shipHints = [/shipping\s+policy/i, /delivery\s+(time|within|in)\b/i, /ships?\s+in\s+\d+/i, /free\s+shipping/i, /standard\s+delivery/i, /express\s+delivery/i];
  for (const re of shipHints) {
    if (re.test(text)) {
      observed.hasShippingText = true;
      const idx = lower.search(re);
      if (idx >= 0) observed.shippingSnippets.push(text.slice(Math.max(0, idx - 20), idx + 80));
      break;
    }
  }
  const retHints = [/return\s+policy/i, /refund\s+policy/i, /\d+[-\s]?day\s+return/i, /money[-\s]?back/i];
  for (const re of retHints) {
    if (re.test(text)) {
      observed.hasReturnsText = true;
      const idx = lower.search(re);
      if (idx >= 0) observed.returnsSnippets.push(text.slice(Math.max(0, idx - 20), idx + 80));
      break;
    }
  }

  for (const re of INJECTION_PATTERNS) {
    if (re.test(text) || re.test(html)) observed.injectionHits.push(re.source);
  }

  return observed;
}

function mergeObserved(target, next) {
  target.products.push(...next.products);
  next.currencies.forEach((c) => target.currencies.add(c));
  target.prices.push(...next.prices);
  if (next.hasShippingText) target.hasShippingText = true;
  if (next.hasReturnsText) target.hasReturnsText = true;
  target.shippingSnippets.push(...next.shippingSnippets);
  target.returnsSnippets.push(...next.returnsSnippets);
  target.injectionHits.push(...next.injectionHits);
  target.openGraph = { ...target.openGraph, ...next.openGraph };
  if (next.merchantName) target.merchantName = next.merchantName;
}

/**
 * Deterministic scoring with commerce-first weights.
 * Zero product+price evidence cannot score as "strong".
 */
export function scoreUrlObservation(observed, meta) {
  const findings = [];
  const evidence = [];

  const products = observed.products || [];
  const priced = products.filter((p) => p.price != null);
  const hasPrice = priced.length > 0 || (observed.prices || []).length > 0;
  const hasCurrency = observed.currencies.size > 0;
  const hasCatalog = products.length > 0;

  // Weights: catalog 25, price/currency 20, shipping 15, returns 10, geo 10, identity 5, AI safety 10, policy 5
  let catalogScore = hasCatalog ? Math.min(100, 40 + products.length * 8) : 0;
  let priceCurScore = 0;
  if (hasPrice && hasCurrency) priceCurScore = 90;
  else if (hasPrice || hasCurrency) priceCurScore = 45;
  else priceCurScore = 0;

  let shippingScore = observed.hasShippingText ? 75 : 0;
  let returnsScore = observed.hasReturnsText ? 80 : 0;
  let geoScore = 0; // never invent
  let identityScore = observed.merchantName || observed.openGraph.site_name || observed.openGraph.title ? 70 : 20;
  let aiSafetyScore = observed.injectionHits.length > 0 ? 15 : 95;
  let policyScore = 25; // public agent limits almost never published

  if (!hasCatalog) {
    findings.push({
      category: "Product Data",
      severity: "HIGH",
      status: "UNKNOWN",
      evidence: "No Product/Offer JSON-LD observed on fetched pages (including discovered product URLs).",
      recommendation: "Expose JSON-LD Product/Offer on product pages, or provide a product CSV / product URL list.",
    });
    evidence.push({ field: "products", status: "UNKNOWN", value: null });
  } else {
    findings.push({
      category: "Product Data",
      severity: "INFO",
      status: "OBSERVED",
      evidence: `Observed ${products.length} product/offer structure(s).`,
      recommendation: "Keep structured product data complete (name, SKU, availability).",
    });
    evidence.push({ field: "products", status: "OBSERVED", value: products.slice(0, 15) });
  }

  if (!hasPrice) {
    findings.push({
      category: "Pricing",
      severity: "HIGH",
      status: "UNKNOWN",
      evidence: "No public price observed in structured data.",
      recommendation: "Publish Offer.price in JSON-LD for agent-readable pricing.",
    });
    evidence.push({ field: "price", status: "UNKNOWN", value: null });
  } else {
    findings.push({
      category: "Pricing",
      severity: "INFO",
      status: "OBSERVED",
      evidence: `Observed price data (${priced.length || observed.prices.length} value(s)).`,
      recommendation: "Ensure every SKU has a clear public price.",
    });
    evidence.push({ field: "price", status: "OBSERVED", value: priced[0]?.price ?? observed.prices[0] });
  }

  if (!hasCurrency) {
    findings.push({
      category: "Currency",
      severity: "HIGH",
      status: "UNKNOWN",
      evidence: "No priceCurrency / currency meta observed.",
      recommendation: "Set Offer.priceCurrency in structured data.",
    });
    evidence.push({ field: "currency", status: "UNKNOWN", value: null });
  } else {
    const list = [...observed.currencies];
    findings.push({
      category: "Currency",
      severity: list.length > 1 ? "MEDIUM" : "INFO",
      status: "OBSERVED",
      evidence: `Observed currency: ${list.join(", ")}`,
      recommendation: list.length > 1 ? "Normalize to a single settlement currency." : "Currency is readable.",
    });
    evidence.push({ field: "currency", status: "OBSERVED", value: list[0] });
  }

  if (!observed.hasShippingText) {
    findings.push({
      category: "Shipping",
      severity: "HIGH",
      status: "UNKNOWN",
      evidence: "No shipping/delivery policy text observed.",
      recommendation: "Publish a public shipping page with clear terms (BUYFIRE will not invent guarantees).",
    });
    evidence.push({ field: "shipping_promise", status: "UNKNOWN", value: null });
  } else {
    findings.push({
      category: "Shipping",
      severity: "INFO",
      status: "OBSERVED",
      evidence: "Shipping/delivery text observed: " + (observed.shippingSnippets[0] || "present"),
      recommendation: "Structure shipping windows so agents can VERIFY before checkout.",
    });
    evidence.push({ field: "shipping_promise", status: "OBSERVED", value: observed.shippingSnippets[0] || true });
  }

  findings.push({
    category: "Shipping",
    severity: "MEDIUM",
    status: "UNKNOWN",
    evidence: "Geographic availability not extracted as structured data.",
    recommendation: "Publish ship-to countries/regions in machine-readable form.",
  });
  evidence.push({ field: "geographic_availability", status: "UNKNOWN", value: null });

  if (!observed.hasReturnsText) {
    findings.push({
      category: "Returns",
      severity: "MEDIUM",
      status: "UNKNOWN",
      evidence: "No return/refund policy text observed.",
      recommendation: "Publish a public returns/refund policy page.",
    });
    evidence.push({ field: "return_policy", status: "UNKNOWN", value: null });
  } else {
    findings.push({
      category: "Returns",
      severity: "INFO",
      status: "OBSERVED",
      evidence: "Return/refund text observed: " + (observed.returnsSnippets[0] || "present"),
      recommendation: "Keep return window and conditions explicit.",
    });
    evidence.push({ field: "return_policy", status: "OBSERVED", value: observed.returnsSnippets[0] || true });
  }

  if (observed.merchantName || observed.openGraph.site_name) {
    findings.push({
      category: "Merchant Identity",
      severity: "INFO",
      status: "OBSERVED",
      evidence: "Site name/title observed: " + (observed.merchantName || observed.openGraph.site_name || observed.openGraph.title),
      recommendation: "Keep consistent public merchant identity signals.",
    });
  } else {
    findings.push({
      category: "Merchant Identity",
      severity: "LOW",
      status: "UNKNOWN",
      evidence: "No clear og:site_name / merchant title observed.",
      recommendation: "Set Open Graph site_name and organization markup.",
    });
  }

  if (observed.injectionHits.length > 0) {
    findings.push({
      category: "AI Safety",
      severity: "HIGH",
      status: "OBSERVED",
      evidence: "Instruction-like patterns detected in public page text (untrusted content).",
      recommendation: "Remove prompt-injection style phrases from product/page copy.",
    });
  } else {
    findings.push({
      category: "AI Safety",
      severity: "INFO",
      status: "OBSERVED",
      evidence: "No known instruction-injection patterns detected in fetched text.",
      recommendation: "Continue treating all merchant HTML as untrusted data.",
    });
  }

  findings.push({
    category: "Purchase Policy",
    severity: "MEDIUM",
    status: "UNKNOWN",
    evidence: "No agent purchase limits / idempotency contract observed.",
    recommendation: "Document max agent transaction limits for autonomous buyers.",
  });
  evidence.push({ field: "purchase_policy", status: "UNKNOWN", value: null });

  let overall = Math.round(
    catalogScore * 0.25 +
      priceCurScore * 0.2 +
      shippingScore * 0.15 +
      returnsScore * 0.1 +
      geoScore * 0.1 +
      identityScore * 0.05 +
      aiSafetyScore * 0.1 +
      policyScore * 0.05
  );

  // Cap score when core commerce evidence is missing
  if (!hasCatalog && !hasPrice) {
    overall = Math.min(overall, 45);
  } else if (!hasCatalog || !hasPrice) {
    overall = Math.min(overall, 62);
  }

  const critical = findings.filter((f) => f.severity === "HIGH").length;
  const warnings = findings.filter((f) => f.severity === "MEDIUM").length;
  const passing = findings.filter((f) => f.severity === "INFO").length;

  let classification = "PARTIAL";
  if (meta.scanIncomplete) classification = "INCOMPLETE";
  else if (!hasCatalog && !hasPrice) classification = "SCAN WEAK";
  else if (hasCatalog && hasPrice && hasCurrency && observed.hasShippingText && overall >= 75) classification = "READY";
  else if (hasCatalog || hasPrice || observed.hasShippingText) classification = "PARTIAL";
  else classification = "SCAN WEAK";

  const recovery =
    classification === "SCAN WEAK" || classification === "INCOMPLETE"
      ? {
          message:
            "Automated public fetch could not verify catalog/price evidence. Upload a product CSV or provide product page URLs for a stronger scan.",
          actions: ["UPLOAD_CSV", "PROVIDE_PRODUCT_URLS", "REQUEST_PAID_AUDIT"],
        }
      : null;

  return {
    scanId: randomUUID(),
    timestamp: now(),
    source: "URL",
    sourceLabel: "PUBLIC URL SCAN",
    isDemo: false,
    storeUrl: meta.storeUrl,
    pagesFetched: meta.pagesFetched || [],
    productUrlsDiscovered: meta.productUrlsDiscovered || [],
    discovery: meta.discovery || {},
    scanIncomplete: !!meta.scanIncomplete,
    incompleteReason: meta.incompleteReason || null,
    classification,
    recovery,
    merchant: {
      id: "merchant_url_" + randomUUID().slice(0, 8),
      name: observed.merchantName || observed.openGraph.site_name || observed.openGraph.title || meta.host || meta.storeUrl,
      currency: observed.currencies.size ? [...observed.currencies][0] : null,
      productCount: products.length,
    },
    readiness: {
      score: overall,
      maxScore: 100,
      label: classification,
      categories: {
        "Product Data": catalogScore,
        Pricing: hasPrice ? (hasCurrency ? 90 : 45) : 0,
        Currency: hasCurrency ? 90 : 0,
        Shipping: shippingScore,
        Returns: returnsScore,
        Geography: geoScore,
        "Merchant Identity": identityScore,
        "AI Safety": aiSafetyScore,
        "Purchase Policy": policyScore,
      },
    },
    findings,
    evidence,
    summary: {
      issueCount: critical + warnings,
      high: critical,
      medium: warnings,
      critical,
      warnings,
      passing,
      unknownFields: evidence.filter((e) => e.status === "UNKNOWN").length,
      observedFields: evidence.filter((e) => e.status === "OBSERVED").length,
      verifiedFields: 0,
      generatedFields: 0,
      productCount: products.length,
    },
    observedProducts: products.slice(0, 20),
    criticalBlockers: findings.filter((f) => f.severity === "HIGH").map((f) => f.evidence),
  };
}

export async function scanPublicUrl(rawUrl) {
  const v = await validatePublicUrl(rawUrl);
  if (!v.ok) {
    return {
      ok: false,
      error: v.error,
      scanIncomplete: true,
      incompleteReason: v.error,
      classification: "INCOMPLETE",
    };
  }

  const origin = v.origin;
  const pagesFetched = [];
  const failures = [];
  const productUrlSet = new Set();
  const discovery = { homepageLinks: 0, sitemapUrls: 0, productPagesFetched: 0 };

  const observed = {
    products: [],
    currencies: new Set(),
    prices: [],
    hasShippingText: false,
    hasReturnsText: false,
    shippingSnippets: [],
    returnsSnippets: [],
    injectionHits: [],
    openGraph: {},
    merchantName: null,
  };

  async function ingest(url) {
    if (pagesFetched.length >= MAX_PAGES) return null;
    if (pagesFetched.some((p) => p.url === url)) return null;
    const res = await fetchText(url);
    if (!res.ok) {
      failures.push({ url, error: res.error, status: res.status });
      return null;
    }
    pagesFetched.push({ url: res.finalUrl || url, status: res.status, truncated: !!res.truncated });
    const ev = extractEvidenceFromHtml(res.text, res.finalUrl || url);
    mergeObserved(observed, ev);
    return res;
  }

  // 1) Homepage
  const home = await ingest(v.url || origin);
  if (home && home.text) {
    const links = extractProductLinks(home.text, origin);
    discovery.homepageLinks = links.length;
    links.slice(0, 20).forEach((l) => productUrlSet.add(l));
  }

  // 2) Common commerce paths
  for (const path of PATH_CANDIDATES) {
    if (pagesFetched.length >= MAX_PAGES) break;
    const target = path ? origin + path : null;
    if (!target) continue;
    const res = await ingest(target);
    if (res && res.text) {
      extractProductLinks(res.text, origin).forEach((l) => productUrlSet.add(l));
    }
  }

  // 3) sitemap.xml
  for (const smPath of ["/sitemap.xml", "/sitemap_index.xml", "/product-sitemap.xml"]) {
    if (productUrlSet.size >= MAX_SITEMAP_URLS) break;
    const sm = await fetchText(origin + smPath);
    if (!sm.ok) {
      failures.push({ url: origin + smPath, error: sm.error, status: sm.status });
      continue;
    }
    let locs = extractSitemapUrls(sm.text, origin);
    if (isSitemapIndex(sm.text)) {
      for (const sub of locs.slice(0, 5)) {
        const sv = await validatePublicUrl(sub);
        if (!sv.ok) continue;
        const subRes = await fetchText(sub);
        if (subRes.ok) locs = locs.concat(extractSitemapUrls(subRes.text, origin));
      }
    }
    discovery.sitemapUrls += locs.length;
    for (const loc of locs) {
      if (isProductUrl(loc)) productUrlSet.add(new URL(loc).origin + new URL(loc).pathname);
      if (productUrlSet.size >= MAX_SITEMAP_URLS) break;
    }
  }

  // 4) Fetch bounded product pages
  const productList = [...productUrlSet].slice(0, MAX_PRODUCT_PAGES);
  for (const pu of productList) {
    if (pagesFetched.length >= MAX_PAGES) break;
    const pv = await validatePublicUrl(pu);
    if (!pv.ok) continue;
    const res = await ingest(pu);
    if (res) discovery.productPagesFetched++;
  }

  if (pagesFetched.length === 0) {
    const reason =
      failures[0]?.error || "Could not fetch any public pages (blocked, timeout, or non-HTML).";
    return {
      ok: false,
      scanIncomplete: true,
      incompleteReason: reason,
      classification: "INCOMPLETE",
      failures: failures.slice(0, 8),
      storeUrl: rawUrl,
      recovery: {
        message:
          "Site could not be inspected automatically. Upload a product CSV or provide product page URLs.",
        actions: ["UPLOAD_CSV", "PROVIDE_PRODUCT_URLS", "REQUEST_PAID_AUDIT"],
      },
    };
  }

  // Hard incomplete if only failures were 403/429 on all attempts with zero HTML success already handled
  const onlyBlocked =
    pagesFetched.length === 0 &&
    failures.some((f) => f.status === 403 || f.status === 429);

  const result = scoreUrlObservation(observed, {
    storeUrl: rawUrl,
    host: v.host,
    pagesFetched,
    productUrlsDiscovered: [...productUrlSet].slice(0, 30),
    discovery,
    scanIncomplete: false,
  });

  if (onlyBlocked) {
    result.scanIncomplete = true;
    result.classification = "INCOMPLETE";
    result.incompleteReason = "HTTP 403/429 — site blocked automated fetch";
  }

  return { ok: true, ...result };
}

/** Test helper */
export function scanHtmlFixture(html, storeUrl = "https://fixture.example") {
  const observed = {
    products: [],
    currencies: new Set(),
    prices: [],
    hasShippingText: false,
    hasReturnsText: false,
    shippingSnippets: [],
    returnsSnippets: [],
    injectionHits: [],
    openGraph: {},
    merchantName: null,
  };
  mergeObserved(observed, extractEvidenceFromHtml(html, storeUrl));
  return scoreUrlObservation(observed, {
    storeUrl,
    host: "fixture.example",
    pagesFetched: [{ url: storeUrl, status: 200 }],
    productUrlsDiscovered: extractProductLinks(html, "https://fixture.example"),
    discovery: { homepageLinks: extractProductLinks(html, "https://fixture.example").length },
  });
}
