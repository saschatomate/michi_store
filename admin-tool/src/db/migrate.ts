import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL ist nicht gesetzt (.env.local prüfen, Supabase-Connection-String).");
  }

  const client = postgres(connectionString, { max: 1, prepare: false, ssl: "require" });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  console.log("Migrations applied.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
