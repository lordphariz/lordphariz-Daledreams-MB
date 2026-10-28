import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDatabase, isDatabaseConfigurationError } from "./database.js";
import type { ApiResult, Database } from "./record-book.js";

type RouteHandler = (database: Database, method: string, id: string | undefined, body: unknown) => Promise<ApiResult>;

export async function respond(
  request: VercelRequest,
  response: VercelResponse,
  handler: RouteHandler,
  hasId: boolean,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  const idValue = request.query.id;
  const id = hasId ? (Array.isArray(idValue) ? idValue[0] : idValue) : undefined;
  try {
    const result = await handler(getDatabase(), request.method || "GET", id, request.body);
    for (const [name, value] of Object.entries(result.headers || {})) response.setHeader(name, value);
    response.status(result.status).json(result.body);
  } catch (error) {
    if (isDatabaseConfigurationError(error)) {
      response.status(503).json({ error: error.message });
      return;
    }
    console.error("Record book API failure", error);
    response.status(500).json({ error: "The record book could not complete this request. Please try again." });
  }
}
