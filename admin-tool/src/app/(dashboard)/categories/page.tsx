import { Tags } from "lucide-react";
import { listCategoryOptions } from "@/lib/categories";
import { CategoryManager } from "@/components/CategoryManager";
import { PRODUCT_TYPES } from "@/lib/custom-product";
import { db } from "@/db/client";
import { productCategories } from "@/db/schema";
import { sql } from "drizzle-orm";

export default async function CategoriesPage() {
  const [categories, counts] = await Promise.all([
    listCategoryOptions(),
    db
      .select({ categoryId: productCategories.categoryId, count: sql<number>`count(*)::int` })
      .from(productCategories)
      .groupBy(productCategories.categoryId),
  ]);

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">Kategorien</h1>
        <p className="mt-0.5 flex items-start gap-1.5 text-sm text-zinc-500">
          <Tags size={15} className="mt-0.5 shrink-0 text-zinc-400" />
          <span>
            Menüstruktur des Shops, beliebig tief (z.B. Lab Diamonds › Amalfi › Ringe). Mit einer Regel
            (Labor/Natur, Schmuckart) schlägt der Editor die Kategorie automatisch vor – die Zuordnung
            bestätigst immer du. Kategorien ohne Regel werden nur von Hand vergeben.
          </span>
        </p>
      </div>
      <CategoryManager
        categories={categories}
        productCounts={Object.fromEntries(counts.map((c) => [c.categoryId, c.count]))}
        productTypes={Object.entries(PRODUCT_TYPES).map(([key, t]) => ({ key, label: t.label }))}
      />
    </div>
  );
}
