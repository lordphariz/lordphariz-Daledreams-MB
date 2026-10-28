import { createServer } from "node:http";
import { createReadStream, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { handleCustomers, handleTransactions } from "./src/lib/record-book.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(root, "public");
const dataRoot = resolve(root, "data");
const databasePath = resolve(dataRoot, "daledreams.sqlite");
mkdirSync(dataRoot, { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(readFileSync(resolve(root, "database", "schema.sql"), "utf8"));

const vendorFiles = new Map([
  ["/vendor/tesseract.js/tesseract.min.js", resolve(root, "node_modules", "tesseract.js", "dist", "tesseract.min.js")],
  ["/vendor/tesseract.js/worker.min.js", resolve(root, "node_modules", "tesseract.js", "dist", "worker.min.js")],
  ["/vendor/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", resolve(root, "node_modules", "tesseract.js-core", "tesseract-core-simd-lstm.wasm.js")],
  ["/vendor/tesseract.js-core/tesseract-core-simd-lstm.wasm", resolve(root, "node_modules", "tesseract.js-core", "tesseract-core-simd-lstm.wasm")],
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  if (!request.headers["content-type"]?.includes("application/json")) {
    throw Object.assign(new Error("Request must use application/json."), { status: 400 });
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 100_000) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw Object.assign(new Error("Request body must be a valid JSON object."), { status: 400 });
  }
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/backup" && request.method === "GET") {
    const customers = database.prepare(
      'SELECT id, full_name AS "fullName", phone, measurements, notes, created_at AS "createdAt", updated_at AS "updatedAt" FROM customers ORDER BY full_name COLLATE NOCASE',
    ).all().map((customer) => ({ ...customer, measurements: JSON.parse(customer.measurements) }));
    const transactions = database.prepare(
      'SELECT id, type, customer_name AS "customerName", expense_name AS "expenseName", amount, date, description, category, created_at AS "createdAt" FROM transactions ORDER BY date DESC, created_at DESC',
    ).all();
    const filename = `daledreams-backup-${new Date().toISOString().slice(0, 10)}.json`;
    sendJson(response, 200, { format: 1, exportedAt: new Date().toISOString(), customers, transactions }, {
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    return;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  let id;
  try {
    id = parts[2] ? decodeURIComponent(parts[2]) : undefined;
  } catch {
    sendJson(response, 400, { error: "Invalid record ID." });
    return;
  }
  const resource = parts[1];
  if (parts.length > 3 || !["customers", "transactions"].includes(resource)) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }
  let body;
  if (request.method === "POST" || request.method === "PUT") {
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, error.status || 400, { error: error.message });
      return;
    }
  }

  const handler = resource === "customers" ? handleCustomers : handleTransactions;
  const result = await handler(database, request.method, id, body);
  sendJson(response, result.status, result.body, result.headers);
}

function serveStatic(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid URL." });
    return;
  }
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(publicRoot, requestedPath);
  if (!filePath.startsWith(`${publicRoot}${sep}`)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }
  createReadStream(filePath)
    .on("open", () => response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    }))
    .on("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: error.code === "ENOENT" ? "File not found." : "Could not read the requested file." });
    })
    .pipe(response);
}

function serveVendor(response, url) {
  const filePath = vendorFiles.get(url.pathname);
  if (!filePath) {
    sendJson(response, 404, { error: "Vendor file not found." });
    return;
  }
  createReadStream(filePath)
    .on("open", () => response.writeHead(200, {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cross-Origin-Resource-Policy": "same-origin",
    }))
    .on("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: "Could not load the local OCR engine." });
    })
    .pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname.startsWith("/vendor/")) {
    serveVendor(response, url);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      console.error("Record book API failure", error);
      sendJson(response, 500, { error: "The record book could not complete this request. Please try again." });
    }
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
    return;
  }
  serveStatic(request, response, url);
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Daledreams Record Book is running at http://${host}:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
