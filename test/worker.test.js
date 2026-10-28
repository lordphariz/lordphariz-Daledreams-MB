import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../src/index.ts";

class MockStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }
  bind(...values) {
    this.values = values;
    return this;
  }
  async all() {
    if (this.sql.includes("FROM customers")) {
      return { results: [...this.database.customers.values()].map((customer) => ({ ...customer })) };
    }
    if (this.sql.includes("FROM transactions")) {
      return { results: [...this.database.transactions.values()].map((transaction) => ({ ...transaction })) };
    }
    throw new Error(`Unexpected query: ${this.sql}`);
  }
  async run() {
    const [id, ...values] = this.values;
    if (this.sql.startsWith("INSERT INTO customers")) {
      const [fullName, phone, measurements, notes] = values;
      this.database.customers.set(id, { id, fullName, phone, measurements, notes, createdAt: "now", updatedAt: "now" });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE customers")) {
      const customer = this.database.customers.get(this.values[4]);
      if (!customer) return { meta: { changes: 0 } };
      [customer.fullName, customer.phone, customer.measurements, customer.notes] = this.values;
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM customers")) {
      return { meta: { changes: Number(this.database.customers.delete(id)) } };
    }
    if (this.sql.startsWith("INSERT INTO transactions")) {
      const [type, customerName, expenseName, amount, date, description, category] = values;
      this.database.transactions.set(id, { id, type, customerName, expenseName, amount, date, description, category, createdAt: "now" });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM transactions")) {
      return { meta: { changes: Number(this.database.transactions.delete(id)) } };
    }
    throw new Error(`Unexpected query: ${this.sql}`);
  }
}

function createEnv() {
  const database = {
    customers: new Map(),
    transactions: new Map(),
    prepare(sql) { return new MockStatement(this, sql); },
  };
  return { DB: database, ASSETS: { fetch: async () => new Response("asset") } };
}

async function request(env, path, method = "GET", data, hostname = "127.0.0.1") {
  const headers = data === undefined ? {} : { "Content-Type": "application/json" };
  const body = data === undefined ? undefined : JSON.stringify(data);
  return worker.fetch(new Request(`http://${hostname}${path}`, { method, headers, body }), env);
}

test("customer records can be created, updated, listed, and deleted", async () => {
  const env = createEnv();
  const created = await request(env, "/api/customers", "POST", {
    fullName: "Amara Okafor",
    phone: "+234 800 123 4567",
    measurements: { Chest: "34", Waist: "28", "Cuff width": "9" },
  });
  assert.equal(created.status, 201);
  const customer = await created.json();
  assert.equal(customer.fullName, "Amara Okafor");
  assert.deepEqual(customer.measurements, { Chest: "34", Waist: "28", "Cuff width": "9" });

  const listed = await request(env, "/api/customers");
  assert.equal((await listed.json()).length, 1);
  const updated = await request(env, `/api/customers/${customer.id}`, "PUT", {
    fullName: "Amara A. Okafor", phone: "+234 800 123 4567", measurements: { Hips: "38" },
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).fullName, "Amara A. Okafor");
  assert.equal((await request(env, `/api/customers/${customer.id}`, "DELETE")).status, 200);
  assert.deepEqual(await (await request(env, "/api/customers")).json(), []);
});

test("income and expense entries are validated and persisted", async () => {
  const env = createEnv();
  const income = await request(env, "/api/transactions", "POST", {
    type: "income", customerName: "Amara Okafor", amount: 25000, date: "2026-10-28", description: "Dress fitting",
  });
  assert.equal(income.status, 201);
  const expense = await request(env, "/api/transactions", "POST", {
    type: "expense", expenseName: "Ankara fabric", amount: 8000, date: "2026-10-28", category: "Fabrics",
  });
  assert.equal(expense.status, 201);
  const listed = await request(env, "/api/transactions");
  assert.deepEqual((await listed.json()).map((item) => item.type), ["income", "expense"]);
  const id = (await income.json()).id;
  assert.equal((await request(env, `/api/transactions/${id}`, "DELETE")).status, 200);
  assert.equal((await request(env, "/api/transactions")).headers.get("cache-control"), "no-store");
});

test("invalid inputs return useful client errors and are not saved", async () => {
  const env = createEnv();
  const invalidCustomer = await request(env, "/api/customers", "POST", {
    fullName: "Amara Okafor", phone: "nope", measurements: {},
  });
  assert.equal(invalidCustomer.status, 400);
  assert.match((await invalidCustomer.json()).error, /valid phone number/i);

  const invalidTransaction = await request(env, "/api/transactions", "POST", {
    type: "expense", expenseName: "Fabric", amount: 0, date: "2026-02-31", category: "Fabrics",
  });
  assert.equal(invalidTransaction.status, 400);
  const invalidPrecision = await request(env, "/api/transactions", "POST", {
    type: "expense", expenseName: "Fabric", amount: 12.345, date: "2026-10-28", category: "Fabrics",
  });
  assert.equal(invalidPrecision.status, 400);
  assert.equal(env.DB.customers.size, 0);
  assert.equal(env.DB.transactions.size, 0);
});

test("deployed API requests fail closed without Cloudflare Access", async () => {
  const env = createEnv();
  const unconfigured = await request(env, "/api/customers", "GET", undefined, "studio.example");
  assert.equal(unconfigured.status, 503);

  env.ACCESS_TEAM_DOMAIN = "studio.cloudflareaccess.com";
  env.ACCESS_AUD = "configured-audience";
  const unauthenticated = await request(env, "/api/customers", "GET", undefined, "studio.example");
  assert.equal(unauthenticated.status, 401);
  assert.equal(env.DB.customers.size, 0);
});

test("deployed API accepts a valid Cloudflare Access JWT", async () => {
  const env = createEnv();
  env.ACCESS_TEAM_DOMAIN = "studio.cloudflareaccess.com";
  env.ACCESS_AUD = "configured-audience";
  const keys = await webcrypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const publicKey = { ...await webcrypto.subtle.exportKey("jwk", keys.publicKey), kid: "test-key" };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "test-key" });
  const claims = encode({
    iss: "https://studio.cloudflareaccess.com",
    aud: "configured-audience",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signingInput = `${header}.${claims}`;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, Buffer.from(signingInput));
  const token = `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [publicKey] });
  try {
    const response = await worker.fetch(new Request("https://studio.example/api/customers", {
      headers: { "cf-access-jwt-assertion": token },
    }), env);
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
