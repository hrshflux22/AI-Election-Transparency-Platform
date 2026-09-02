import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

export const isDatabaseConfigured = Boolean(connectionString);
export const db = connectionString ? drizzle(neon(connectionString), { schema }) : null;

export function databaseUnavailable() {
  return new Response(
    JSON.stringify({ error: "Database is not configured. Set DATABASE_URL to enable this endpoint." }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}
