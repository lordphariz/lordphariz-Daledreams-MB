import { neon } from "@neondatabase/serverless";
import type { Database } from "./record-book.js";

class DatabaseConfigurationError extends Error {}

export function getDatabase(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new DatabaseConfigurationError("DATABASE_URL is not configured. Add your PostgreSQL connection string in Vercel project settings.");
  }
  const sql = neon(connectionString);
  return {
    async query<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      return await sql.query(text, params) as T[];
    },
  };
}

export function isDatabaseConfigurationError(error: unknown): error is DatabaseConfigurationError {
  return error instanceof DatabaseConfigurationError;
}
