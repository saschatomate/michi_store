import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { categories } from "@/db/schema";
import type { CategoryNode } from "@/lib/category-rules";

export type CategoryOption = CategoryNode & { label: string; depth: number; slug: string; active: boolean };

// Alle Kategorien als flache Liste mit Pfad ("Lab Diamonds › Ringe"), Eltern vor Kindern, in
// Sortierreihenfolge. Der Baum ist beliebig tief (parentId). Inaktive Kategorien sind enthalten
// (für die Verwaltung); der Editor blendet sie per `onlyActive` aus.
export async function listCategoryOptions(opts?: { onlyActive?: boolean }): Promise<CategoryOption[]> {
  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id));
  const usable = opts?.onlyActive ? rows.filter((r) => r.active) : rows;
  const byParent = new Map<number | null, typeof usable>();
  for (const r of usable) {
    const list = byParent.get(r.parentId) ?? [];
    list.push(r);
    byParent.set(r.parentId, list);
  }

  const out: CategoryOption[] = [];
  const walk = (parentId: number | null, prefix: string, depth: number) => {
    for (const r of byParent.get(parentId) ?? []) {
      const label = prefix ? `${prefix} › ${r.name}` : r.name;
      out.push({
        id: r.id,
        parentId: r.parentId,
        name: r.name,
        ruleStoneOrigin: r.ruleStoneOrigin,
        ruleProductType: r.ruleProductType,
        label,
        depth,
        slug: r.slug,
        active: r.active,
      });
      walk(r.id, label, depth + 1);
    }
  };
  walk(null, "", 0);
  return out;
}
