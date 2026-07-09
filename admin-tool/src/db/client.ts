import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL ist nicht gesetzt (.env.local prüfen, Supabase-Connection-String).");
}

// prepare: false ist bei Supabase Pflicht, sobald der Transaction Pooler (Port 6543) verwendet wird –
// der Pooler unterstützt keine Prepared Statements über Verbindungen hinweg.
const client = postgres(connectionString, { prepare: false, ssl: "require" });

export const db = drizzle(client, { schema });
