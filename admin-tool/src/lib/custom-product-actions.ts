"use server";

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  sourceProducts,
  categories,
  productCategories,
  productAuditLog,
  type CustomImage,
} from "@/db/schema";
import { requireAuth } from "@/lib/dal";
import {
  CUSTOM_SKU_PREFIX,
  getMissingFields,
  parseCustomProductForm,
  type CustomProductForm,
} from "@/lib/custom-product";
import { createSignedImageUpload, publicImageUrl, removeStoredImages } from "@/lib/image-storage";

type ProductRow = typeof sourceProducts.$inferSelect;

export type SaveResult =
  | { ok: true; id: number; missing: string[] }
  | { ok: false; errors: Record<string, string> };

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_IMAGES_PER_PRODUCT = 12;

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diff(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = before ? before[key] : null;
    if (!valuesEqual(from, to)) changes[key] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}

async function logAudit(
  productId: number,
  action: string,
  changes: Record<string, { from: unknown; to: unknown }> | null,
) {
  if (changes && Object.keys(changes).length === 0) return;
  await db.insert(productAuditLog).values({ sourceProductId: productId, action, changes });
}

async function categoryCount(productId: number): Promise<number> {
  const rows = await db
    .select({ id: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.sourceProductId, productId));
  return rows.length;
}

// Setzt/löst den Status "Daten unvollständig" - aber nur für Produkte, die noch ganz am Anfang
// stehen (neu/unvollständig). Ist ein Produkt schon weiter im Prozess, wird sein Status durch eine
// Bearbeitung nicht still zurückgesetzt.
async function syncCompletenessStatus(productId: number): Promise<string[]> {
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, productId) });
  if (!product) throw new Error("Produkt nicht gefunden.");

  const missing = getMissingFields(product, product.customImages?.length ?? 0, await categoryCount(productId));

  let nextStatus = product.status;
  if (missing.length > 0 && product.status === "neu") nextStatus = "unvollstaendig";
  if (missing.length === 0 && product.status === "unvollstaendig") nextStatus = "neu";

  if (nextStatus !== product.status) {
    await db.update(sourceProducts).set({ status: nextStatus, updatedAt: new Date() }).where(eq(sourceProducts.id, productId));
    await logAudit(productId, "status", { status: { from: product.status, to: nextStatus } });
  }
  return missing;
}

function auditSnapshot(row: ProductRow | Partial<typeof sourceProducts.$inferInsert>): Record<string, unknown> {
  const keys = [
    "kurzBezeichnungDe",
    "langBezeichnungDe",
    "hauptkategorie",
    "stoneOrigin",
    "hauptmaterial",
    "fineness",
    "rhodiniert",
    "legierungsgewicht",
    "cutShape",
    "diamantSchliffguete",
    "mainStoneCt",
    "caratur",
    "anzahlSteine",
    "diamantFarbe",
    "diamantReinheit",
    "certInstitute",
    "certNumber",
    "designFamilyId",
    "ringSizes",
    "uvp",
    "einkaufspreis",
  ] as const;
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) snapshot[key] = (row as Record<string, unknown>)[key] ?? null;
  return snapshot;
}

export async function saveCustomProduct(id: number | null, form: CustomProductForm): Promise<SaveResult> {
  await requireAuth();

  const parsed = parseCustomProductForm(form);

  if (parsed.categoryIds.length > 0) {
    const found = await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, parsed.categoryIds));
    if (found.length !== parsed.categoryIds.length) parsed.errors.categories = "Unbekannte Kategorie ausgewählt.";
  }
  if (Object.keys(parsed.errors).length > 0) return { ok: false, errors: parsed.errors };

  let productId: number;

  if (id === null) {
    // Ohne Namen gibt es nichts, was man später in der Liste wiederfinden könnte.
    if (!parsed.values.kurzBezeichnungDe) {
      return { ok: false, errors: { name: "Bitte mindestens einen Produktnamen angeben." } };
    }

    productId = await db.transaction(async (tx) => {
      // modellErweitert ist NOT NULL + unique, die laufende Nummer entsteht aber erst aus der id -
      // deshalb zuerst mit einem Platzhalter einfügen und dann die echte SKU setzen.
      const [row] = await tx
        .insert(sourceProducts)
        .values({
          ...parsed.values,
          modellErweitert: `${CUSTOM_SKU_PREFIX}TMP-${randomUUID()}`,
          origin: "custom",
          status: "unvollstaendig",
          bestand: 0,
        })
        .returning({ id: sourceProducts.id });
      await tx
        .update(sourceProducts)
        .set({ modellErweitert: `${CUSTOM_SKU_PREFIX}${String(row.id).padStart(6, "0")}` })
        .where(eq(sourceProducts.id, row.id));
      return row.id;
    });
    await logAudit(productId, "created", diff(null, auditSnapshot(parsed.values)));
  } else {
    const existing = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
    if (!existing) throw new Error("Produkt nicht gefunden.");
    if (existing.origin !== "custom") {
      throw new Error("Nur selbst angelegte Produkte können im Editor bearbeitet werden.");
    }
    if (!parsed.values.kurzBezeichnungDe) {
      return { ok: false, errors: { name: "Der Produktname darf nicht leer sein." } };
    }

    productId = id;
    await db
      .update(sourceProducts)
      .set({ ...parsed.values, updatedAt: new Date() })
      .where(eq(sourceProducts.id, id));
    await logAudit(id, "updated", diff(auditSnapshot(existing), auditSnapshot(parsed.values)));
  }

  // Kategorien ersetzen (Vergleich vorher/nachher für das Protokoll).
  const before = await db
    .select({ id: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.sourceProductId, productId));
  const beforeIds = before.map((r) => r.id).sort((a, b) => a - b);
  const afterIds = [...parsed.categoryIds].sort((a, b) => a - b);
  if (!valuesEqual(beforeIds, afterIds)) {
    await db.transaction(async (tx) => {
      await tx.delete(productCategories).where(eq(productCategories.sourceProductId, productId));
      if (afterIds.length > 0) {
        await tx.insert(productCategories).values(afterIds.map((categoryId) => ({ sourceProductId: productId, categoryId })));
      }
    });
    await logAudit(productId, "updated", { categories: { from: beforeIds, to: afterIds } });
  }

  const missing = await syncCompletenessStatus(productId);

  revalidatePath("/");
  revalidatePath(`/products/${productId}`);
  return { ok: true, id: productId, missing };
}

// --- Bilder ---------------------------------------------------------------------------------

async function requireCustomProduct(productId: number): Promise<ProductRow> {
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, productId) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (product.origin !== "custom") throw new Error("Bilder können nur bei selbst angelegten Produkten verwaltet werden.");
  return product;
}

export async function createImageUploadUrls(
  productId: number,
  files: { contentType: string }[],
): Promise<{ signedUrl: string; path: string }[]> {
  await requireAuth();
  const product = await requireCustomProduct(productId);

  if ((product.customImages?.length ?? 0) + files.length > MAX_IMAGES_PER_PRODUCT) {
    throw new Error(`Maximal ${MAX_IMAGES_PER_PRODUCT} Bilder pro Produkt.`);
  }

  return Promise.all(
    files.map((file) => {
      const ext = ALLOWED_IMAGE_TYPES[file.contentType];
      if (!ext) throw new Error(`Dateityp "${file.contentType}" wird nicht unterstützt (JPG, PNG oder WebP).`);
      return createSignedImageUpload(`custom/${productId}/${randomUUID()}.${ext}`);
    }),
  );
}

async function writeImages(product: ProductRow, images: CustomImage[]) {
  await db
    .update(sourceProducts)
    .set({
      customImages: images,
      // Das erste Bild ist das Hauptbild (Freisteller-Slot, wird auch als Referenz für die
      // KI-Bildpipeline genutzt), der Rest läuft über die bestehende Bilderliste.
      freistellerUrl: images[0]?.url ?? null,
      modelbildUrl: null,
      bildUrls: images.slice(1).map((i) => i.url),
      updatedAt: new Date(),
    })
    .where(eq(sourceProducts.id, product.id));
  await logAudit(product.id, "images", {
    images: { from: (product.customImages ?? []).map((i) => i.path), to: images.map((i) => i.path) },
  });
  await syncCompletenessStatus(product.id);
  revalidatePath("/");
  revalidatePath(`/products/${product.id}`);
}

// Wird aufgerufen, nachdem der Browser die Dateien hochgeladen hat. Prüft, dass die Pfade zu diesem
// Produkt gehören und die Dateien wirklich erreichbar sind, bevor sie ins Produkt übernommen werden.
export async function registerCustomImages(productId: number, paths: string[]): Promise<void> {
  await requireAuth();
  const product = await requireCustomProduct(productId);

  const prefix = `custom/${productId}/`;
  const known = new Set((product.customImages ?? []).map((i) => i.path));
  const added: CustomImage[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix) || path.includes("..")) throw new Error("Ungültiger Bildpfad.");
    if (known.has(path)) continue;
    const url = publicImageUrl(path);
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) throw new Error(`Bild wurde nicht korrekt hochgeladen (${res.status}): ${path}`);
    added.push({ url, path });
  }
  if (added.length === 0) return;
  await writeImages(product, [...(product.customImages ?? []), ...added]);
}

// Setzt Reihenfolge neu (erstes = Hauptbild). Muss exakt dieselbe Menge Bilder enthalten.
export async function reorderCustomImages(productId: number, paths: string[]): Promise<void> {
  await requireAuth();
  const product = await requireCustomProduct(productId);
  const current = product.customImages ?? [];
  const byPath = new Map(current.map((i) => [i.path, i]));
  if (paths.length !== current.length || paths.some((p) => !byPath.has(p))) {
    throw new Error("Bildreihenfolge passt nicht zu den vorhandenen Bildern - bitte Seite neu laden.");
  }
  await writeImages(
    product,
    paths.map((p) => byPath.get(p)!),
  );
}

export async function removeCustomImage(productId: number, path: string): Promise<void> {
  await requireAuth();
  const product = await requireCustomProduct(productId);
  const current = product.customImages ?? [];
  if (!current.some((i) => i.path === path)) throw new Error("Bild nicht gefunden.");
  await writeImages(
    product,
    current.filter((i) => i.path !== path),
  );
  await removeStoredImages([path]).catch(() => {});
}
