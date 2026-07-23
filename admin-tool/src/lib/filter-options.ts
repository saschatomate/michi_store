import "server-only";
import { isNotNull, desc, ne } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { sourceProducts, importRuns } from "@/db/schema";

async function distinctValues(column: PgColumn) {
  const rows = await db
    .selectDistinct({ value: column })
    .from(sourceProducts)
    .where(isNotNull(column));
  return rows
    .map((r) => r.value as string | null)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b, "de"));
}

export type ImportRunOption = { id: number; filename: string; startedAt: Date };

export type FilterOptions = {
  kategorien1: string[];
  kategorien2: string[];
  kategorien3: string[];
  materialien: string[];
  legierungen: string[];
  runs: ImportRunOption[];
};

// Wird im (dashboard)-Layout geladen (unabhängig von der aktuellen Filterauswahl) und an die
// Sidebar durchgereicht, damit das Filterpanel dort - unter der Navigation - ohne eigenen
// DB-Zugriff auskommt (Sidebar ist eine Client-Komponente).
export async function getFilterOptions(): Promise<FilterOptions> {
  const [kategorien1, kategorien2, kategorien3, materialien, legierungen, runs] = await Promise.all([
    distinctValues(sourceProducts.kategorieEbene1),
    distinctValues(sourceProducts.kategorieEbene2),
    distinctValues(sourceProducts.kategorieEbene3),
    distinctValues(sourceProducts.hauptmaterial),
    distinctValues(sourceProducts.legierung),
    db
      .select({ id: importRuns.id, filename: importRuns.filename, startedAt: importRuns.startedAt })
      .from(importRuns)
      .where(ne(importRuns.status, "running"))
      .orderBy(desc(importRuns.startedAt))
      .limit(15),
  ]);

  return { kategorien1, kategorien2, kategorien3, materialien, legierungen, runs };
}
