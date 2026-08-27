import { db } from "@/db/client";
import { apiUsageEvents } from "@/db/schema";
import { gte, sql } from "drizzle-orm";

async function main() {
  const todayStart = new Date("2026-08-27T00:00:00.000Z");
  const rows = await db
    .select({
      provider: apiUsageEvents.provider,
      purpose: apiUsageEvents.purpose,
      count: sql<number>`count(*)::int`,
      totalCostUsd: sql<number>`sum(cost_usd)::float`,
    })
    .from(apiUsageEvents)
    .where(gte(apiUsageEvents.createdAt, todayStart))
    .groupBy(apiUsageEvents.provider, apiUsageEvents.purpose);
  let total = 0;
  for (const r of rows) {
    console.log(r.provider, r.purpose, "calls:", r.count, "cost: $" + r.totalCostUsd.toFixed(4));
    total += r.totalCostUsd;
  }
  console.log("TOTAL heute: $" + total.toFixed(2));
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
