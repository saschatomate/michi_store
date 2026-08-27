import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const id = Number(process.argv[2]);
  const key = process.argv[3];
  await db.update(sourceProducts).set({ assignedModelKey: key }).where(eq(sourceProducts.id, id));
  const row = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  console.log("assignedModelKey jetzt:", row?.assignedModelKey);
}
main().then(() => process.exit(0));
