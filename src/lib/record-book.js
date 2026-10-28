const standardMeasurements = new Set([
  "Chest", "Waist", "Hips", "Shoulder", "Sleeve", "Armhole",
  "Blouse length", "Skirt / trouser length", "Neck", "Thigh",
]);
const expenseCategories = new Set(["Fabrics", "Accessories", "Transport", "Equipment", "Utilities", "Rent", "Other"]);

function readString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} is required and must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
}

function parseCustomer(body) {
  const fullName = readString(body.fullName, "Full name", 120);
  const phone = readString(body.phone, "Phone number", 40);
  const phoneDigits = phone.replace(/\D/g, "");
  if (!/^[+\d\s().-]+$/.test(phone) || phoneDigits.length < 5 || phoneDigits.length > 15) {
    throw new Error("Phone number must contain 5 to 15 digits and may use +, spaces, parentheses, hyphens, or dots.");
  }
  const rawMeasurements = body.measurements === undefined ? {} : body.measurements;
  if (!rawMeasurements || typeof rawMeasurements !== "object" || Array.isArray(rawMeasurements)) {
    throw new Error("Measurements must be an object.");
  }
  const entries = Object.entries(rawMeasurements);
  if (entries.length > 30) throw new Error("A customer can have up to 30 measurements.");
  const measurements = {};
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

function readDate(value) {
  const date = readString(value, "Date", 10);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error("Date must be a valid calendar date in YYYY-MM-DD format.");
  }
  return date;
}

function parseTransaction(body) {
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

function inputError(error) {
  return { status: 400, body: { error: error instanceof Error ? error.message : "Invalid request." } };
}

function methodNotAllowed(allowed) {
  return { status: 405, body: { error: "Method not allowed." }, headers: { Allow: allowed } };
}

function parseMeasurements(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export async function handleCustomers(database, method, id, rawBody) {
  if (method === "GET" && !id) {
    const customers = database.prepare(
      'SELECT id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt" FROM customers ORDER BY full_name COLLATE NOCASE',
    ).all().map((customer) => ({ ...customer, measurements: parseMeasurements(customer.measurements) }));
    return { status: 200, body: customers };
  }
  if ((method === "POST" && !id) || (method === "PUT" && id)) {
    let input;
    try {
      if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new Error("Request body must be a JSON object.");
      input = parseCustomer(rawBody);
    } catch (error) {
      return inputError(error);
    }
    if (method === "POST") {
      const customerId = crypto.randomUUID();
      database.prepare("INSERT INTO customers (id, full_name, phone, measurements, notes) VALUES (?, ?, ?, ?, ?)")
        .run(customerId, input.fullName, input.phone, JSON.stringify(input.measurements), input.notes);
      const customer = database.prepare(
        'SELECT id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt" FROM customers WHERE id = ?',
      ).get(customerId);
      return { status: 201, body: { ...customer, measurements: parseMeasurements(customer.measurements) } };
    }
    const result = database.prepare("UPDATE customers SET full_name = ?, phone = ?, measurements = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.fullName, input.phone, JSON.stringify(input.measurements), input.notes, id);
    if (!result.changes) return { status: 404, body: { error: "Customer not found." } };
    const customer = database.prepare(
      'SELECT id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt" FROM customers WHERE id = ?',
    ).get(id);
    return { status: 200, body: { ...customer, measurements: parseMeasurements(customer.measurements) } };
  }
  if (method === "DELETE" && id) {
    const result = database.prepare("DELETE FROM customers WHERE id = ?").run(id);
    return result.changes ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "Customer not found." } };
  }
  return methodNotAllowed(id ? "PUT, DELETE" : "GET, POST");
}

export async function handleTransactions(database, method, id, rawBody) {
  if (method === "GET" && !id) {
    const transactions = database.prepare(
      'SELECT id, type, customer_name AS "customerName", expense_name AS "expenseName", amount, date, description, category, created_at AS "createdAt" FROM transactions ORDER BY date DESC, created_at DESC',
    ).all();
    return { status: 200, body: transactions };
  }
  if ((method === "POST" && !id) || (method === "PUT" && id)) {
    let input;
    try {
      if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) throw new Error("Request body must be a JSON object.");
      input = parseTransaction(rawBody);
    } catch (error) {
      return inputError(error);
    }
    const transactionId = method === "POST" ? crypto.randomUUID() : id;
    if (method === "POST") {
      database.prepare("INSERT INTO transactions (id, type, customer_name, expense_name, amount, date, description, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(transactionId, input.type, input.customerName ?? null, input.expenseName ?? null, input.amount, input.date, input.description, input.category ?? null);
    } else {
      const result = database.prepare("UPDATE transactions SET type = ?, customer_name = ?, expense_name = ?, amount = ?, date = ?, description = ?, category = ? WHERE id = ?")
        .run(input.type, input.customerName ?? null, input.expenseName ?? null, input.amount, input.date, input.description, input.category ?? null, id);
      if (!result.changes) return { status: 404, body: { error: "Transaction not found." } };
    }
    const transaction = database.prepare(
      'SELECT id, type, customer_name AS "customerName", expense_name AS "expenseName", amount, date, description, category, created_at AS "createdAt" FROM transactions WHERE id = ?',
    ).get(transactionId);
    return { status: method === "POST" ? 201 : 200, body: transaction };
  }
  if (method === "DELETE" && id) {
    const result = database.prepare("DELETE FROM transactions WHERE id = ?").run(id);
    return result.changes ? { status: 200, body: { ok: true } } : { status: 404, body: { error: "Transaction not found." } };
  }
  return methodNotAllowed(id ? "PUT, DELETE" : "GET, POST");
}
