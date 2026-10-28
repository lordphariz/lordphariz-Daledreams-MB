import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCustomers } from "../../src/lib/record-book.js";
import { respond } from "../../src/lib/vercel-api.js";

export default function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  return respond(request, response, handleCustomers, true);
}
