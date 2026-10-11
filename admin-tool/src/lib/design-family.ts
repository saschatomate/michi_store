import { and, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts } from "@/db/schema";
import { STONE_ORIGIN_LABELS, type FamilyMember } from "@/lib/custom-product";

function memberDetail(r: {
  hauptmaterial: string | null;
  legierung: string | null;
  mainStoneCt: number | null;
  caratur: number | null;
  stoneOrigin: "lab_grown" | "natural" | null;
  diamantReinheit: string | null;
}): string {
  return [
    r.hauptmaterial,
    r.legierung,
    r.mainStoneCt ?? r.caratur ? `${r.mainStoneCt ?? r.caratur} ct` : null,
    r.stoneOrigin ? STONE_ORIGIN_LABELS[r.stoneOrigin] : null,
    r.diamantReinheit,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Alle Produkte, die eine Design-Family-ID tragen (optional ohne ein bestimmtes Produkt).
export async function listFamilyMembers(excludeProductId?: number): Promise<FamilyMember[]> {
  const rows = await db
    .select({
      id: sourceProducts.id,
      familyId: sourceProducts.designFamilyId,
      name: sourceProducts.kurzBezeichnungDe,
      sku: sourceProducts.modellErweitert,
      hauptmaterial: sourceProducts.hauptmaterial,
      legierung: sourceProducts.legierung,
      mainStoneCt: sourceProducts.mainStoneCt,
      caratur: sourceProducts.caratur,
      stoneOrigin: sourceProducts.stoneOrigin,
      diamantReinheit: sourceProducts.diamantReinheit,
    })
    .from(sourceProducts)
    .where(
      excludeProductId === undefined
        ? isNotNull(sourceProducts.designFamilyId)
        : and(isNotNull(sourceProducts.designFamilyId), ne(sourceProducts.id, excludeProductId)),
    );

  return rows.map((r) => ({
    id: r.id,
    familyId: r.familyId!,
    name: r.name ?? r.sku,
    detail: memberDetail(r),
  }));
}

export async function listSiblings(productId: number, familyId: string): Promise<FamilyMember[]> {
  const all = await listFamilyMembers(productId);
  return all.filter((m) => m.familyId === familyId);
}

