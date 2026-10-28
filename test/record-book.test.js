import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomers, handleTransactions } from "../src/lib/record-book.ts";

function createDatabase() {
  const customers = [];
  const transactions = [];
  let nextId = 1;
  return {
    customers,
    transactions,
    async query(text, params = []) {
      if (text.startsWith("SELECT") && text.includes("FROM customers")) return customers.map((row) => ({ ...row }));
      if (text.startsWith("SELECT") && text.includes("FROM transactions")) return transactions.map((row) => ({ ...row }));
      if (text.startsWith("INSERT INTO customers")) {
        const [fullName, phone, measurements, notes] = params;
        const customer = { id: String(nextId++), fullName, phone, measurements: JSON.parse(measurements), notes };
        customers.push(customer);
        return [{ ...customer }];
      }
      if (text.startsWith("UPDATE customers")) {
        const [fullName, phone, measurements, notes, id] = params;
        const customer = customers.find((item) => item.id === id);
        if (!customer) return [];
        Object.assign(customer, { fullName, phone, measurements: JSON.parse(measurements), notes });
        return [{ ...customer }];
      }
      if (text.startsWith("DELETE FROM customers")) {
        const index = customers.findIndex((item) => item.id === params[0]);
        if (index < 0) return [];
        return [customers.splice(index, 1)[0]];
      }
      if (text.startsWith("INSERT INTO transactions")) {
        const [type, customerName, expenseName, amount, date, description, category] = params;
        const transaction = { id: String(nextId++), type, customerName, expenseName, amount, date, description, category };
        transactions.push(transaction);
        return [{ ...transaction }];
      }
      if (text.startsWith("DELETE FROM transactions")) {
        const index = transactions.findIndex((item) => item.id === params[0]);
        if (index < 0) return [];
        return [transactions.splice(index, 1)[0]];
      }
      throw new Error(`Unexpected SQL query: ${text}`);
    },
  };
}

test("customer records can be created, updated, listed, and deleted", async () => {
  const database = createDatabase();
  const created = await handleCustomers(database, "POST", undefined, {
    fullName: "Amara Okafor",
    phone: "+234 800 123 4567",
    measurements: { Chest: "34", Waist: "28", "Cuff width": "9" },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.measurements, { Chest: "34", Waist: "28", "Cuff width": "9" });

  const listed = await handleCustomers(database, "GET", undefined, undefined);
  assert.equal(listed.body.length, 1);
  const id = created.body.id;
  const updated = await handleCustomers(database, "PUT", id, {
    fullName: "Amara A. Okafor",
    phone: "+234 800 123 4567",
    measurements: { Hips: "38" },
  });
  assert.equal(updated.body.fullName, "Amara A. Okafor");
  assert.equal((await handleCustomers(database, "DELETE", id, undefined)).status, 200);
  assert.deepEqual((await handleCustomers(database, "GET", undefined, undefined)).body, []);
});

test("income and expense transactions are validated and persisted", async () => {
  const database = createDatabase();
  const income = await handleTransactions(database, "POST", undefined, {
    type: "income", customerName: "Amara Okafor", amount: 25000.5, date: "2026-10-28", description: "Dress fitting",
  });
  const expense = await handleTransactions(database, "POST", undefined, {
    type: "expense", expenseName: "Ankara fabric", amount: 8000, date: "2026-10-28", category: "Fabrics",
  });
  assert.equal(income.status, 201);
  assert.equal(expense.status, 201);
  assert.deepEqual((await handleTransactions(database, "GET", undefined, undefined)).body.map((item) => item.type), ["income", "expense"]);
  assert.equal((await handleTransactions(database, "DELETE", income.body.id, undefined)).status, 200);
});

test("invalid inputs are rejected without database writes", async () => {
  const database = createDatabase();
  const customer = await handleCustomers(database, "POST", undefined, {
    fullName: "Amara Okafor", phone: "nope", measurements: {},
  });
  assert.equal(customer.status, 400);
  assert.match(customer.body.error, /valid phone number/i);

  const invalidDate = await handleTransactions(database, "POST", undefined, {
    type: "expense", expenseName: "Fabric", amount: 12, date: "2026-02-31", category: "Fabrics",
  });
  const invalidPrecision = await handleTransactions(database, "POST", undefined, {
    type: "expense", expenseName: "Fabric", amount: 12.345, date: "2026-10-28", category: "Fabrics",
  });
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidPrecision.status, 400);
  assert.equal(database.customers.length, 0);
  assert.equal(database.transactions.length, 0);
});

test("unsupported methods are explicit", async () => {
  const result = await handleTransactions(createDatabase(), "PUT", undefined, {});
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, "GET, POST");
});
