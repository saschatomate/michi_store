"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { categories, productCategories, STONE_ORIGIN_VALUES, type StoneOrigin } from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import { PRODUCT_TYPES } from "@/lib/custom-product";

export type CategoryInput = {
  name: string;
  parentId: number | null;
  ruleStoneOrigin: StoneOrigin | "";
  ruleProductType: string[];
  introText: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanRules(input: CategoryInput) {
  if (input.ruleStoneOrigin && !STONE_ORIGIN_VALUES.includes(input.ruleStoneOrigin)) {
    throw new Error("Unbekannte Regel für Labor/Natur.");
  }
  const types = input.ruleProductType.filter(Boolean);
  const unknown = types.find((t) => !(t in PRODUCT_TYPES));
  if (unknown) throw new Error(`Unbekannte Schmuckart in der Regel: ${unknown}`);
  return {
    ruleStoneOrigin: input.ruleStoneOrigin || null,
    ruleProductType: types.length > 0 ? types.join(",") : null,
    introText: input.introText.trim() || null,
  };
}

function refresh() {
  revalidatePath("/categories");
  revalidatePath("/products/new");
}

export async function createCategory(input: CategoryInput): Promise<void> {
  await requireAuth();
  const name = input.name.trim();
  if (!name) throw new Error("Bitte einen Namen angeben.");

  const parent = input.parentId ? await db.query.categories.findFirst({ where: eq(categories.id, input.parentId) }) : null;
  if (input.parentId && !parent) throw new Error("Übergeordnete Kategorie nicht gefunden.");

  // Slug = Pfad aus Eltern-Slug und Name, bei Kollision mit Zähler. Bleibt nach Umbenennen stabil
  // (er wird später als Shopify-Collection-Handle gebraucht).
  const base = parent ? `${parent.slug}-${slugify(name)}` : slugify(name);
  if (!base) throw new Error("Aus dem Namen lässt sich kein gültiger Slug bilden.");
  let slug = base;
  for (let i = 2; await db.query.categories.findFirst({ where: eq(categories.slug, slug) }); i++) {
    slug = `${base}-${i}`;
  }

  const siblings = await db
    .select({ sortOrder: categories.sortOrder })
    .from(categories)
    .where(input.parentId ? eq(categories.parentId, input.parentId) : isNull(categories.parentId));
  const nextSort = siblings.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 10;

  await db.insert(categories).values({
    name,
    slug,
    parentId: input.parentId,
    sortOrder: nextSort,
    ...cleanRules(input),
  });
  refresh();
}

export async function updateCategory(id: number, input: CategoryInput & { active: boolean }): Promise<void> {
  await requireAuth();
  const name = input.name.trim();
  if (!name) throw new Error("Bitte einen Namen angeben.");

  // Zyklen verhindern: neuer Elternteil darf nicht die Kategorie selbst oder einer ihrer Nachfahren sein.
  if (input.parentId !== null) {
    const all = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories);
    const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
    if (!parentOf.has(input.parentId)) throw new Error("Übergeordnete Kategorie nicht gefunden.");
    for (let cur: number | null | undefined = input.parentId; cur; cur = parentOf.get(cur)) {
      if (cur === id) throw new Error("Eine Kategorie kann nicht in sich selbst oder in einer Unterkategorie liegen.");
    }
  }

  await db
    .update(categories)
    .set({ name, parentId: input.parentId, active: input.active, ...cleanRules(input) })
    .where(eq(categories.id, id));
  refresh();
}

export async function moveCategory(id: number, direction: -1 | 1): Promise<void> {
  await requireAuth();
  const current = await db.query.categories.findFirst({ where: eq(categories.id, id) });
  if (!current) throw new Error("Kategorie nicht gefunden.");

  const siblings = await db
    .select({ id: categories.id })
    .from(categories)
    .where(current.parentId ? eq(categories.parentId, current.parentId) : isNull(categories.parentId))
    .orderBy(asc(categories.sortOrder), asc(categories.id));
  const ids = siblings.map((s) => s.id);
  const index = ids.indexOf(id);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];

  // Komplett neu durchnummerieren, damit gleiche sortOrder-Werte nie zu uneindeutiger Reihenfolge führen.
  await db.transaction(async (tx) => {
    for (const [i, siblingId] of ids.entries()) {
      await tx.update(categories).set({ sortOrder: (i + 1) * 10 }).where(eq(categories.id, siblingId));
    }
  });
  refresh();
}

// Nur leere Kategorien (ohne Unterkategorien und ohne zugeordnete Produkte) lassen sich löschen -
// sonst bleibt Deaktivieren der Weg.
export async function deleteCategory(id: number): Promise<void> {
  await requireAuth();
  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1);
  if (children.length > 0) throw new Error("Die Kategorie hat Unterkategorien - bitte zuerst diese löschen oder verschieben.");
  const used = await db
    .select({ id: productCategories.sourceProductId })
    .from(productCategories)
    .where(and(eq(productCategories.categoryId, id)))
    .limit(1);
  if (used.length > 0) throw new Error("Der Kategorie sind Produkte zugeordnet - bitte stattdessen deaktivieren.");
  await db.delete(categories).where(eq(categories.id, id));
  refresh();
}
