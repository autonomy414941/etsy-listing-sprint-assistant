import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildListingPack,
  parseKeywordCsv,
  parseMaterialsCsv,
  sanitizeListingInput,
  type ListingInput,
  type ListingPack
} from "./listing.js";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const DATA_DIR = process.env.DATA_DIR || "/data";
const MAX_BODY_BYTES = 512 * 1024;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://etsy-listing.46.225.49.219.nip.io";
const PAYMENT_URL = process.env.PAYMENT_URL || "https://buy.stripe.com/test_eVq6oH8mqf5WeQJ2jQ";
const PRICE_USD = Number.parseFloat(process.env.PRICE_USD || "19");

const STATE_FILE = path.join(DATA_DIR, "state.json");
const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");
const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../site");

const STATIC_MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

type EventType =
  | "landing_view"
  | "brief_generated"
  | "checkout_started"
  | "payment_evidence_submitted"
  | "listing_exported";

type BriefIntent = "manual_submit" | "auto_preview" | "sample_cta" | "unknown";

type PaymentProof = {
  submittedAt: string;
  payerEmail: string;
  transactionId: string;
  evidenceUrl?: string;
  note?: string;
};

type ListingSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  selfTest: boolean;
  input: ListingInput;
  pack: ListingPack;
  paid: boolean;
  paymentProof?: PaymentProof;
};

type EventRecord = {
  eventId: string;
  eventType: EventType;
  timestamp: string;
  source: string;
  selfTest: boolean;
  sessionId: string | null;
  details: Record<string, unknown>;
};

type State = {
  sessions: Record<string, ListingSession>;
  events: EventRecord[];
};

type JsonObject = Record<string, unknown>;
type MetricsCounts = Record<EventType, number>;

const EVENT_TYPES: EventType[] = [
  "landing_view",
  "brief_generated",
  "checkout_started",
  "payment_evidence_submitted",
  "listing_exported"
];

const state: State = {
  sessions: {},
  events: []
};

let stateWriteQueue: Promise<void> = Promise.resolve();
let eventWriteQueue: Promise<void> = Promise.resolve();

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  response.end(JSON.stringify(payload));
}

function parseBoolean(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function normalizeSource(value: unknown, fallback = "web"): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(normalized)) {
    return fallback;
  }
  return normalized;
}

function normalizeBriefIntent(value: unknown): BriefIntent {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "manual_submit" || normalized === "auto_preview" || normalized === "sample_cta") {
    return normalized;
  }
  return "unknown";
}

function asOptionalString(payload: JsonObject, key: string, maxLength = 200): string | undefined {
  const raw = payload[key];
  if (raw == null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new Error(`invalid_${key}`);
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > maxLength) {
    throw new Error(`invalid_${key}`);
  }
  return trimmed;
}

function asRequiredString(payload: JsonObject, key: string, maxLength = 200): string {
  const value = asOptionalString(payload, key, maxLength);
  if (!value) {
    throw new Error(`invalid_${key}`);
  }
  return value;
}

function asOptionalInteger(payload: JsonObject, key: string): number | undefined {
  const raw = payload[key];
  if (raw == null || raw === "") {
    return undefined;
  }
  const parsed =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid_${key}`);
  }
  return parsed;
}

function asOptionalBoolean(payload: JsonObject, key: string): boolean | undefined {
  if (!(key in payload)) {
    return undefined;
  }
  return parseBoolean(payload[key]);
}

function parseSessionId(payload: JsonObject): string {
  const sessionId = asRequiredString(payload, "sessionId", 120);
  if (!/^[a-zA-Z0-9-]{8,120}$/.test(sessionId)) {
    throw new Error("invalid_sessionId");
  }
  return sessionId;
}

function emptyCounts(): MetricsCounts {
  return {
    landing_view: 0,
    brief_generated: 0,
    checkout_started: 0,
    payment_evidence_submitted: 0,
    listing_exported: 0
  };
}

function calculateCounts(selfTestFilter?: boolean): MetricsCounts {
  const counts = emptyCounts();
  for (const event of state.events) {
    if (typeof selfTestFilter === "boolean" && event.selfTest !== selfTestFilter) {
      continue;
    }
    counts[event.eventType] += 1;
  }
  return counts;
}

function calculateDailyCounts(selfTestFilter?: boolean): Array<{ date: string; counts: MetricsCounts }> {
  const bucket = new Map<string, MetricsCounts>();
  for (const event of state.events) {
    if (typeof selfTestFilter === "boolean" && event.selfTest !== selfTestFilter) {
      continue;
    }
    const date = event.timestamp.slice(0, 10);
    const counts = bucket.get(date) ?? emptyCounts();
    counts[event.eventType] += 1;
    bucket.set(date, counts);
  }
  return [...bucket.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));
}

async function saveState(): Promise<void> {
  const payload = JSON.stringify(state);
  stateWriteQueue = stateWriteQueue
    .catch(() => undefined)
    .then(() => writeFile(STATE_FILE, payload, "utf8"));
  await stateWriteQueue;
}

async function appendEvent(record: EventRecord): Promise<void> {
  eventWriteQueue = eventWriteQueue
    .catch(() => undefined)
    .then(() => appendFile(EVENTS_FILE, `${JSON.stringify(record)}\n`, "utf8"));
  await eventWriteQueue;
}

async function recordEvent(
  eventType: EventType,
  options: {
    source: string;
    selfTest: boolean;
    sessionId?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  const event: EventRecord = {
    eventId: randomUUID(),
    eventType,
    timestamp: new Date().toISOString(),
    source: options.source,
    selfTest: options.selfTest,
    sessionId: options.sessionId ?? null,
    details: options.details ?? {}
  };
  state.events.push(event);
  await Promise.all([saveState(), appendEvent(event)]);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^invalid_[a-zA-Z0-9_]+$/.test(error.message)) {
    return error.message;
  }
  return "invalid_request";
}

async function parseBody(request: http.IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("invalid_body_too_large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_json");
  }

  return parsed as JsonObject;
}

async function serveStatic(requestPath: string, response: http.ServerResponse): Promise<boolean> {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const normalized = path.posix.normalize(pathname);
  if (normalized.includes("..")) {
    return false;
  }

  const filePath = path.join(SITE_DIR, normalized);
  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": STATIC_MIME[ext] || "application/octet-stream"
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

function readSelfTestQuery(url: URL): boolean | undefined {
  if (!url.searchParams.has("selfTest")) {
    return undefined;
  }
  return parseBoolean(url.searchParams.get("selfTest"));
}

function parseStringArray(payload: JsonObject, key: string, maxItems: number, maxLength: number): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new Error(`invalid_${key}`);
  }

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`invalid_${key}`);
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > maxLength) {
      throw new Error(`invalid_${key}`);
    }
    result.push(trimmed);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function parseKeywords(payload: JsonObject): string[] {
  const keywordsCsv = asOptionalString(payload, "supportingKeywordsCsv", 5000);
  if (keywordsCsv) {
    return parseKeywordCsv(keywordsCsv);
  }

  if ("supportingKeywords" in payload) {
    return parseStringArray(payload, "supportingKeywords", 16, 80);
  }

  return [];
}

function normalizeKeywordSeed(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9&\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackKeywords(primaryKeyword: string, productType: string, targetAudience: string): string[] {
  const candidates = [
    primaryKeyword,
    `${primaryKeyword} gift`,
    `${productType} gift`,
    `${targetAudience} gift`,
    `${productType} etsy`,
    "handmade gift"
  ];

  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeKeywordSeed(candidate);
    if (!normalized || normalized.length > 80 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  if (!result.length) {
    return ["etsy gift"];
  }

  return result.slice(0, 8);
}

function parseMaterials(payload: JsonObject): string[] {
  const materialsCsv = asOptionalString(payload, "materialsCsv", 3000);
  if (materialsCsv) {
    return parseMaterialsCsv(materialsCsv);
  }

  if (!("materials" in payload)) {
    return [];
  }

  return parseStringArray(payload, "materials", 12, 80);
}

function parseGenerateInput(payload: JsonObject): {
  input: ListingInput;
  source: string;
  selfTest: boolean;
  briefIntent: BriefIntent;
} {
  const shopName = asOptionalString(payload, "shopName", 80) || "Your Etsy Shop";
  const productType = asRequiredString(payload, "productType", 80);
  const targetAudience = asOptionalString(payload, "targetAudience", 80) || "etsy shoppers";
  const primaryKeyword = asOptionalString(payload, "primaryKeyword", 80) || productType;
  const parsedSupportingKeywords = parseKeywords(payload);
  const supportingKeywords = parsedSupportingKeywords.length
    ? parsedSupportingKeywords
    : buildFallbackKeywords(primaryKeyword, productType, targetAudience);
  const materials = parseMaterials(payload);
  const tone = ((asOptionalString(payload, "tone", 20) || "warm").toLowerCase() as ListingInput["tone"]);
  const priceBand = asOptionalString(payload, "priceBand", 80) || "$20-$45";
  const processingTimeDays = asOptionalInteger(payload, "processingTimeDays") ?? 3;
  const personalization = asOptionalBoolean(payload, "personalization") ?? true;
  const includeUkSpelling = asOptionalBoolean(payload, "includeUkSpelling") ?? false;

  const source = normalizeSource(payload.source, "web");
  const selfTest = parseBoolean(payload.selfTest);
  const briefIntent = normalizeBriefIntent(payload.briefIntent);

  const input = sanitizeListingInput({
    shopName,
    productType,
    targetAudience,
    primaryKeyword,
    supportingKeywords,
    materials,
    tone,
    priceBand,
    processingTimeDays,
    personalization,
    includeUkSpelling
  });

  return {
    input,
    source,
    selfTest,
    briefIntent
  };
}

function buildExportText(session: ListingSession): string {
  const lines: string[] = [];
  lines.push("Etsy Listing Sprint Assistant Export");
  lines.push(`Session: ${session.sessionId}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Shop: ${session.input.shopName}`);
  lines.push(`Product: ${session.input.productType}`);
  lines.push(`Score: ${session.pack.score}`);
  lines.push("");
  lines.push("TITLE");
  lines.push(session.pack.title);
  lines.push("");
  lines.push("TAGS");
  for (const tag of session.pack.tags) {
    lines.push(`- ${tag}`);
  }
  lines.push("");
  lines.push("HIGHLIGHTS");
  for (const highlight of session.pack.highlights) {
    lines.push(`- ${highlight}`);
  }
  lines.push("");
  lines.push("DESCRIPTION");
  lines.push(session.pack.description);
  lines.push("");
  lines.push("FAQ");
  for (const item of session.pack.faq) {
    lines.push(`Q: ${item.question}`);
    lines.push(`A: ${item.answer}`);
  }
  lines.push("");
  lines.push("PHOTO SHOT LIST");
  for (const item of session.pack.photoShotList) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("LAUNCH CHECKLIST");
  for (const item of session.pack.launchChecklist) {
    lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

async function loadState(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<State>;
    if (parsed.sessions && typeof parsed.sessions === "object") {
      state.sessions = parsed.sessions as Record<string, ListingSession>;
    }
    if (Array.isArray(parsed.events)) {
      state.events = parsed.events.filter((event): event is EventRecord => {
        return Boolean(event && typeof event === "object" && EVENT_TYPES.includes((event as EventRecord).eventType));
      });
    }
  } catch {
    await saveState();
  }
  await appendFile(EVENTS_FILE, "", "utf8");
}

const server = http.createServer(async (request, response) => {
  const method = request.method || "GET";
  const url = new URL(request.url || "/", PUBLIC_BASE_URL);
  const pathname = url.pathname;

  if (method === "OPTIONS" && pathname.startsWith("/api/")) {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    response.end();
    return;
  }

  try {
    if (method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "etsy-listing-sprint-assistant",
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && pathname === "/api/metrics") {
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        totals: {
          includingSelfTests: calculateCounts(),
          excludingSelfTests: calculateCounts(false)
        },
        activeSessions: Object.keys(state.sessions).length
      });
      return;
    }

    if (method === "GET" && pathname === "/api/metrics/daily") {
      const selfTestFilter = readSelfTestQuery(url);
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        selfTestFilter,
        days: calculateDailyCounts(selfTestFilter)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/paid-proof/count") {
      const selfTestFilter = readSelfTestQuery(url);
      const paymentCounts = state.events.filter((event) => {
        if (event.eventType !== "payment_evidence_submitted") {
          return false;
        }
        if (typeof selfTestFilter === "boolean" && event.selfTest !== selfTestFilter) {
          return false;
        }
        return true;
      }).length;

      sendJson(response, 200, {
        paymentEvidenceEvents: paymentCounts,
        selfTestFilter
      });
      return;
    }

    if (method === "POST" && pathname === "/api/listings/generate") {
      const payload = await parseBody(request);
      const { input, source, selfTest, briefIntent } = parseGenerateInput(payload);
      const sessionId = randomUUID();
      const timestamp = new Date().toISOString();
      const pack = buildListingPack(input);

      const session: ListingSession = {
        sessionId,
        createdAt: timestamp,
        updatedAt: timestamp,
        source,
        selfTest,
        input,
        pack,
        paid: false
      };

      state.sessions[sessionId] = session;

      await recordEvent("brief_generated", {
        source,
        selfTest,
        sessionId,
        details: {
          score: pack.score,
          tags: pack.tags.length,
          tone: input.tone,
          briefIntent
        }
      });

      sendJson(response, 200, {
        sessionId,
        pack,
        paywall: {
          priceUsd: PRICE_USD,
          paymentUrl: PAYMENT_URL,
          unlockAction: "listing_export"
        }
      });
      return;
    }

    if (method === "POST" && pathname === "/api/billing/checkout") {
      const payload = await parseBody(request);
      const sessionId = parseSessionId(payload);
      const session = state.sessions[sessionId];
      if (!session) {
        sendJson(response, 404, {
          error: "session_not_found"
        });
        return;
      }

      const source = normalizeSource(payload.source, session.source);
      const selfTest = parseBoolean(payload.selfTest) || session.selfTest;

      await recordEvent("checkout_started", {
        source,
        selfTest,
        sessionId,
        details: {
          priceUsd: PRICE_USD
        }
      });

      sendJson(response, 200, {
        checkoutMode: "payment_link",
        paymentUrl: PAYMENT_URL,
        priceUsd: PRICE_USD
      });
      return;
    }

    if (method === "POST" && pathname === "/api/billing/proof") {
      const payload = await parseBody(request);
      const sessionId = parseSessionId(payload);
      const session = state.sessions[sessionId];
      if (!session) {
        sendJson(response, 404, {
          error: "session_not_found"
        });
        return;
      }

      const payerEmail = asRequiredString(payload, "payerEmail", 160);
      const transactionId = asRequiredString(payload, "transactionId", 120);
      const evidenceUrl = asOptionalString(payload, "evidenceUrl", 300);
      const note = asOptionalString(payload, "note", 400);
      const source = normalizeSource(payload.source, session.source);
      const selfTest = parseBoolean(payload.selfTest) || session.selfTest;

      session.paid = true;
      session.updatedAt = new Date().toISOString();
      session.paymentProof = {
        submittedAt: session.updatedAt,
        payerEmail,
        transactionId,
        evidenceUrl,
        note
      };

      await recordEvent("payment_evidence_submitted", {
        source,
        selfTest,
        sessionId,
        details: {
          transactionId,
          payerEmail
        }
      });

      sendJson(response, 200, {
        status: "accepted",
        sessionId,
        unlocked: true
      });
      return;
    }

    if (method === "POST" && pathname === "/api/listings/export") {
      const payload = await parseBody(request);
      const sessionId = parseSessionId(payload);
      const session = state.sessions[sessionId];
      if (!session) {
        sendJson(response, 404, {
          error: "session_not_found"
        });
        return;
      }

      if (!session.paid) {
        sendJson(response, 402, {
          error: "payment_required",
          checkoutMode: "payment_link",
          paymentUrl: PAYMENT_URL,
          priceUsd: PRICE_USD
        });
        return;
      }

      const source = normalizeSource(payload.source, session.source);
      const selfTest = parseBoolean(payload.selfTest) || session.selfTest;
      const format = asOptionalString(payload, "format", 20) || "json";

      await recordEvent("listing_exported", {
        source,
        selfTest,
        sessionId,
        details: {
          format,
          tags: session.pack.tags.length,
          score: session.pack.score
        }
      });

      if (format === "text") {
        sendJson(response, 200, {
          sessionId,
          format: "text",
          fileName: `etsy-listing-${sessionId.slice(0, 8)}.txt`,
          content: buildExportText(session)
        });
        return;
      }

      sendJson(response, 200, {
        sessionId,
        format: "json",
        fileName: `etsy-listing-${sessionId.slice(0, 8)}.json`,
        export: {
          input: session.input,
          pack: session.pack
        }
      });
      return;
    }

    if (method === "GET" && pathname === "/") {
      const source = normalizeSource(url.searchParams.get("source"), "direct");
      const selfTest = parseBoolean(url.searchParams.get("selfTest"));
      await recordEvent("landing_view", {
        source,
        selfTest,
        details: {
          userAgent: request.headers["user-agent"] || "unknown"
        }
      });
    }

    if (method === "GET") {
      const served = await serveStatic(pathname, response);
      if (served) {
        return;
      }
    }

    sendJson(response, 404, {
      error: "not_found"
    });
  } catch (error) {
    const code = safeErrorCode(error);
    sendJson(response, 400, {
      error: code
    });
  }
});

async function main(): Promise<void> {
  await loadState();
  server.listen(PORT, HOST, () => {
    console.log(`etsy-listing-sprint-assistant listening on http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
