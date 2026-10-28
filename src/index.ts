interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

interface CustomerInput {
  fullName: string;
  phone: string;
  measurements: Record<string, string>;
  notes: string;
}

interface TransactionInput {
  type: "income" | "expense";
  amount: number;
  date: string;
  description: string;
  customerName?: string;
  expenseName?: string;
  category?: string;
}

const measurementKeys = new Set([
  "Chest", "Waist", "Hips", "Shoulder", "Sleeve", "Armhole",
  "Blouse length", "Skirt / trouser length", "Neck", "Thigh",
]);
const categories = new Set(["Fabrics", "Accessories", "Transport", "Equipment", "Utilities", "Rent", "Other"]);
let accessKeys: { teamDomain: string; expiresAt: number; keys: AccessSigningKey[] } | null = null;

interface AccessClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
}

interface AccessHeader {
  alg?: string;
  kid?: string;
}

interface AccessSigningKey extends JsonWebKey {
  kid?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function readDate(value: unknown): string {
  const date = readString(value, "Date", 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("Date must be a valid calendar date in YYYY-MM-DD format.");
  }
  return date;
}

function parseCustomer(body: Record<string, unknown>): CustomerInput {
  const fullName = readString(body.fullName, "Full name", 120);
  const phone = readString(body.phone, "Phone number", 40);
  if (!/^[+\d\s().-]{5,40}$/.test(phone)) throw new Error("Enter a valid phone number.");
  const rawMeasurements = body.measurements === undefined ? {} : body.measurements;
  if (!rawMeasurements || typeof rawMeasurements !== "object" || Array.isArray(rawMeasurements)) {
    throw new Error("Measurements must be an object.");
  }
  if (Object.keys(rawMeasurements).length > 30) throw new Error("A customer can have up to 30 measurements.");
  const measurements: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawMeasurements)) {
    if ((!measurementKeys.has(key) && (!key.trim() || key.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(key))) || key !== key.trim()) {
      throw new Error("Measurement names must be 1 to 40 characters without control characters or surrounding spaces.");
    }
    if (typeof value !== "string" || value.length > 30) throw new Error(`${key} must be 30 characters or fewer.`);
    if (value.trim()) measurements[key] = value.trim();
  }
  const notes = body.notes === undefined || body.notes === "" ? "" : readString(body.notes, "Notes", 1000);
  return { fullName, phone, measurements, notes };
}

function parseTransaction(body: Record<string, unknown>): TransactionInput {
  if (body.type !== "income" && body.type !== "expense") throw new Error("Transaction type must be income or expense.");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000 || Number(amount.toFixed(2)) !== amount) {
    throw new Error("Amount must be greater than zero, no more than 1,000,000,000,000, and have at most 2 decimal places.");
  }
  const date = readDate(body.date);
  const description = body.description === undefined || body.description === "" ? "" : readString(body.description, "Description", 500);
  if (body.type === "income") {
    return { type: "income", amount, date, description, customerName: readString(body.customerName, "Customer name", 120) };
  }
  const expenseName = readString(body.expenseName, "Expense name", 120);
  const category = readString(body.category, "Category", 40);
  if (!categories.has(category)) throw new Error("Choose a valid expense category.");
  return { type: "expense", amount, date, description, expenseName, category };
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("Request must use application/json.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

function badRequest(error: unknown): Response {
  return json({ error: error instanceof Error ? error.message : "Invalid request." }, 400);
}

async function getAccessKeys(teamDomain: string): Promise<AccessSigningKey[]> {
  if (accessKeys?.teamDomain === teamDomain && accessKeys.expiresAt > Date.now()) return accessKeys.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Cloudflare Access certificates could not be loaded (${response.status}).`);
  const payload: { keys?: AccessSigningKey[] } = await response.json();
  if (!Array.isArray(payload.keys)) throw new Error("Cloudflare Access returned an invalid certificate set.");
  accessKeys = { teamDomain, keys: payload.keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return accessKeys.keys;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hasValidAccessToken(request: Request, teamDomain: string, audience: string): Promise<boolean> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let header: AccessHeader;
  let claims: AccessClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    header.alg !== "RS256"
    || !header.kid
    || claims.iss !== `https://${teamDomain}`
    || !audiences.includes(audience)
    || typeof claims.exp !== "number"
    || claims.exp <= now
    || (typeof claims.nbf === "number" && claims.nbf > now)
  ) return false;

  let signingKey = (await getAccessKeys(teamDomain)).find((key) => key.kid === header.kid);
  if (!signingKey) {
    accessKeys = null;
    signingKey = (await getAccessKeys(teamDomain)).find((key) => key.kid === header.kid);
  }
  if (!signingKey) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk", signingKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const resource = segments[0];
  const id = segments[1];
  if (resource === "customers" && !id && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, full_name AS fullName, phone, measurements, notes, created_at AS createdAt, updated_at AS updatedAt FROM customers ORDER BY full_name COLLATE NOCASE").all();
    return json((result.results || []).map((row) => ({ ...row, measurements: JSON.parse(String(row.measurements)) })));
  }
  if (resource === "customers" && request.method === "POST") {
    let input: CustomerInput;
    try {
      input = parseCustomer(await requestBody(request));
    } catch (error) { return badRequest(error); }
    const customerId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO customers (id, full_name, phone, measurements, notes) VALUES (?, ?, ?, ?, ?)")
      .bind(customerId, input.fullName, input.phone, JSON.stringify(input.measurements), input.notes).run();
    return json({ id: customerId, ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 201);
  }
  if (resource === "customers" && id && request.method === "PUT") {
    let input: CustomerInput;
    try {
      input = parseCustomer(await requestBody(request));
    } catch (error) { return badRequest(error); }
    const result = await env.DB.prepare("UPDATE customers SET full_name = ?, phone = ?, measurements = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(input.fullName, input.phone, JSON.stringify(input.measurements), input.notes, id).run();
    if (!result.meta.changes) return json({ error: "Customer not found." }, 404);
    return json({ id, ...input });
  }
  if (resource === "customers" && id && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM customers WHERE id = ?").bind(id).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: "Customer not found." }, 404);
  }
  if (resource === "transactions" && !id && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, type, customer_name AS customerName, expense_name AS expenseName, amount, date, description, category, created_at AS createdAt FROM transactions ORDER BY date DESC, created_at DESC").all();
    return json(result.results || []);
  }
  if (resource === "transactions" && request.method === "POST") {
    let input: TransactionInput;
    try {
      input = parseTransaction(await requestBody(request));
    } catch (error) { return badRequest(error); }
    const transactionId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO transactions (id, type, customer_name, expense_name, amount, date, description, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(transactionId, input.type, input.customerName ?? null, input.expenseName ?? null, input.amount, input.date, input.description, input.category ?? null).run();
    return json({ id: transactionId, ...input, createdAt: new Date().toISOString() }, 201);
  }
  if (resource === "transactions" && id && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(id).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: "Transaction not found." }, 404);
  }
  return json({ error: "API route not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { Allow: "GET, POST, PUT, DELETE, OPTIONS" } });
    }
    try {
      const isLocalRequest = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
      if (!isLocalRequest) {
        const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
        const audience = env.ACCESS_AUD?.trim();
        if (
          !teamDomain
          || teamDomain === "your-team.cloudflareaccess.com"
          || !/^[a-z\d.-]+$/i.test(teamDomain)
          || !audience
          || audience === "SET_FROM_CLOUDFLARE_ACCESS"
        ) {
          return json({ error: "Cloudflare Access is not configured for this application." }, 503);
        }
        if (!(await hasValidAccessToken(request, teamDomain, audience))) {
          return json({ error: "A valid Cloudflare Access session is required." }, 401);
        }
      }
      return await handleApi(request, env);
    } catch (error) {
      console.error("Daledreams API failure", error);
      return json({ error: "The record book could not complete this request. Please try again." }, 500);
    }
  },
};
