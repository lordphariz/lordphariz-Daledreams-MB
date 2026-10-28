export interface Database {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
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

const standardMeasurements = new Set([
  "Chest", "Waist", "Hips", "Shoulder", "Sleeve", "Armhole",
  "Blouse length", "Skirt / trouser length", "Neck", "Thigh",
]);
const expenseCategories = new Set(["Fabrics", "Accessories", "Transport", "Equipment", "Utilities", "Rent", "Other"]);

function readString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function parseCustomer(body: Record<string, unknown>): CustomerInput {
  const fullName = readString(body.fullName, "Full name", 120);
  const phone = readString(body.phone, "Phone number", 40);
  if (!/^[+\d\s().-]{5,40}$/.test(phone)) throw new Error("Enter a valid phone number.");
  const rawMeasurements = body.measurements === undefined ? {} : body.measurements;
  if (!rawMeasurements || typeof rawMeasurements !== "object" || Array.isArray(rawMeasurements)) {
    throw new Error("Measurements must be an object.");
  }
  const entries = Object.entries(rawMeasurements);
  if (entries.length > 30) throw new Error("A customer can have up to 30 measurements.");
  const measurements: Record<string, string> = {};
  for (const [key, value] of entries) {
    if ((!standardMeasurements.has(key) && (!key.trim() || key.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(key))) || key !== key.trim()) {
      throw new Error("Measurement names must be 1 to 40 characters without control characters or surrounding spaces.");
    }
    if (typeof value !== "string" || value.length > 30) throw new Error(`${key} must be 30 characters or fewer.`);
    if (value.trim()) measurements[key] = value.trim();
  }
  const notes = body.notes === undefined || body.notes === "" ? "" : readString(body.notes, "Notes", 1000);
  return { fullName, phone, measurements, notes };
}

function readDate(value: unknown): string {
  const date = readString(value, "Date", 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("Date must be a valid calendar date in YYYY-MM-DD format.");
  }
  return date;
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
  if (!expenseCategories.has(category)) throw new Error("Choose a valid expense category.");
  return { type: "expense", amount, date, description, expenseName, category };
}

function inputError(error: unknown): ApiResult {
  return { status: 400, body: { error: error instanceof Error ? error.message : "Invalid request." } };
}

function methodNotAllowed(allowed: string): ApiResult {
  return { status: 405, body: { error: "Method not allowed." }, headers: { Allow: allowed } };
}

export async function handleCustomers(
  database: Database,
  method: string,
  id: string | undefined,
  rawBody: unknown,
): Promise<ApiResult> {
  if (method === "GET" && !id) {
    const customers = await database.query(
      'SELECT id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt" FROM customers ORDER BY full_name COLLATE "C"',
    );
    return { status: 200, body: customers };
  }
  if ((method === "POST" && !id) || (method === "PUT" && id)) {
    let input: CustomerInput;
    try {
      if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new Error("Request body must be a JSON object.");
      input = parseCustomer(rawBody as Record<string, unknown>);
    } catch (error) {
      return inputError(error);
    }
    if (method === "POST") {
      const [customer] = await database.query(
        'INSERT INTO customers (full_name, phone, measurements, notes) VALUES ($1, $2, $3::jsonb, $4) RETURNING id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt"',
        [input.fullName, input.phone, JSON.stringify(input.measurements), input.notes],
      );
      return { status: 201, body: customer };
    }
    const [customer] = await database.query(
      'UPDATE customers SET full_name = $1, phone = $2, measurements = $3::jsonb, notes = $4, updated_at = NOW() WHERE id = $5 RETURNING id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt"',
      [input.fullName, input.phone, JSON.stringify(input.measurements), input.notes, id],
    );
    return customer ? { status: 200, body: customer } : { status: 404, body: { error: "Customer not found." } };
  }
  if (method === "DELETE" && id) {
    const [customer] = await database.query("DELETE FROM customers WHERE id = $1 RETURNING id", [id]);
    return customer ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "Customer not found." } };
  }
  return methodNotAllowed(id ? "PUT, DELETE" : "GET, POST");
}

export async function handleTransactions(
  database: Database,
  method: string,
  id: string | undefined,
  rawBody: unknown,
): Promise<ApiResult> {
  if (method === "GET" && !id) {
    const transactions = await database.query(
      'SELECT id, type, customer_name AS "customerName", expense_name AS "expenseName", amount, TO_CHAR(date, \'YYYY-MM-DD\') AS date, description, category, created_at AS "createdAt" FROM transactions ORDER BY date DESC, created_at DESC',
    );
    return { status: 200, body: transactions };
  }
  if (method === "POST" && !id) {
    let input: TransactionInput;
    try {
      if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new Error("Request body must be a JSON object.");
      input = parseTransaction(rawBody as Record<string, unknown>);
    } catch (error) {
      return inputError(error);
    }
    const [transaction] = await database.query(
      'INSERT INTO transactions (type, customer_name, expense_name, amount, date, description, category) VALUES ($1, $2, $3, $4, $5::date, $6, $7) RETURNING id, type, customer_name AS "customerName", expense_name AS "expenseName", amount, TO_CHAR(date, \'YYYY-MM-DD\') AS date, description, category, created_at AS "createdAt"',
      [input.type, input.customerName ?? null, input.expenseName ?? null, input.amount, input.date, input.description, input.category ?? null],
    );
    return { status: 201, body: transaction };
  }
  if (method === "DELETE" && id) {
    const [transaction] = await database.query("DELETE FROM transactions WHERE id = $1 RETURNING id", [id]);
    return transaction ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "Transaction not found." } };
  }
  return methodNotAllowed(id ? "DELETE" : "GET, POST");
}
