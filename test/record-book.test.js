import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handleCustomers, handleTransactions } from "../src/lib/record-book.js";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8"));
  return database;
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
  assert.equal((await handleCustomers(database, "GET", undefined, undefined)).body.length, 1);
  const updated = await handleCustomers(database, "PUT", created.body.id, {
    fullName: "Amara A. Okafor", phone: "+234 800 123 4567", measurements: { Hips: "38" },
  });
  assert.equal(updated.body.fullName, "Amara A. Okafor");
  assert.equal((await handleCustomers(database, "DELETE", created.body.id, undefined)).status, 200);
  assert.deepEqual((await handleCustomers(database, "GET", undefined, undefined)).body, []);
  database.close();
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
  const updated = await handleTransactions(database, "PUT", income.body.id, {
    type: "expense", expenseName: "Alteration supplies", amount: 1300, date: "2026-10-29", category: "Accessories",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.type, "expense");
  assert.equal(updated.body.expenseName, "Alteration supplies");
  assert.equal((await handleTransactions(database, "PUT", "missing-id", {
    type: "income", customerName: "Amara Okafor", amount: 100, date: "2026-10-29",
  })).status, 404);
  assert.equal((await handleTransactions(database, "DELETE", income.body.id, undefined)).status, 200);
  database.close();
});

test("invalid inputs are rejected without database writes", async () => {
  const database = createDatabase();
  const customer = await handleCustomers(database, "POST", undefined, {
    fullName: "Amara Okafor", phone: "nope", measurements: {},
  });
  assert.equal(customer.status, 400);
  assert.match(customer.body.error, /5 to 15 digits/i);
  const shortPhone = await handleCustomers(database, "POST", undefined, {
    fullName: "Amara Okafor", phone: "5355", measurements: {},
  });
  assert.equal(shortPhone.status, 400);
  assert.match(shortPhone.body.error, /5 to 15 digits/i);

  const invalidDate = await handleTransactions(database, "POST", undefined, {
    type: "expense", expenseName: "Fabric", amount: 12, date: "2026-02-31", category: "Fabrics",
  });
  const invalidPrecision = await handleTransactions(database, "POST", undefined, {
    type: "expense", expenseName: "Fabric", amount: 12.345, date: "2026-10-28", category: "Fabrics",
  });
  assert.equal(invalidDate.status, 400);
  assert.equal(invalidPrecision.status, 400);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM customers").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 0);
  database.close();
});

test("unsupported methods are explicit", async () => {
  const database = createDatabase();
  const result = await handleTransactions(database, "PATCH", undefined, {});
  assert.equal(result.status, 405);
  assert.equal(result.headers.Allow, "GET, POST");
  database.close();
});
