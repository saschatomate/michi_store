import { db } from "@/db/client";
import { importRuns, sourceProducts } from "@/db/schema";
import { desc } from "drizzle-orm";

async function main() {
  const runs = await db.query.importRuns.findMany({
    orderBy: [desc(importRuns.id)],
    limit: 10,
  });
  console.log("Letzte 10 Import-Runs:");
  for (const r of runs) {
    console.log({
      id: r.id,
      filename: r.filename,
      source: r.source,
      status: r.status,
      rowsTotal: r.rowsTotal,
      rowsUpdated: r.rowsUpdated,
      finishedAt: r.finishedAt,
      createdAt: (r as any).createdAt,
    });
  }
}
main().then(() => process.exit(0));
