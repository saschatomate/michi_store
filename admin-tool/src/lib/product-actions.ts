"use server";

import { inArray, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { sourceProducts, STATUS_VALUES, type ProductStatus } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { sendToPipelineWebhook } from "@/lib/pipeline-webhook";

export async function sendSelectedToPipeline(ids: number[]): Promise<{ sent: number }> {
  await requireAuth();
  if (ids.length === 0) return { sent: 0 };

  const rows = await db.query.sourceProducts.findMany({
    where: inArray(sourceProducts.id, ids),
    columns: { id: true, modellErweitert: true },
  });

  await db
    .update(sourceProducts)
    .set({
      status: "in_pipeline",
      sentToPipelineAt: new Date(),
      updatedAt: new Date(),
    })
    .where(inArray(sourceProducts.id, ids));

  await Promise.all(rows.map((r) => sendToPipelineWebhook({ sourceProductId: r.id, modellErweitert: r.modellErweitert })));

  revalidatePath("/");
  revalidatePath("/mapping");
  return { sent: rows.length };
}

export async function updateProductStatus(id: number, status: ProductStatus): Promise<void> {
  await requireAuth();
  if (!STATUS_VALUES.includes(status)) {
    throw new Error(`Unbekannter Status: ${status}`);
  }

  await db
    .update(sourceProducts)
    .set({ status, updatedAt: new Date() })
    .where(eq(sourceProducts.id, id));

  revalidatePath("/");
  revalidatePath(`/products/${id}`);
  revalidatePath("/mapping");
}
