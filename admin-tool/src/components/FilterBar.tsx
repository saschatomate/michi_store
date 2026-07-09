import { isNotNull } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/db/client";
import { sourceProducts, STATUS_VALUES } from "@/db/schema";
import { STATUS_LABELS } from "@/components/StatusBadge";
import type { ProductFilters } from "@/lib/product-query";

async function distinctValues(column: SQLiteColumn) {
  const rows = await db
    .selectDistinct({ value: column })
    .from(sourceProducts)
    .where(isNotNull(column));
  return rows
    .map((r) => r.value as string | null)
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => a.localeCompare(b, "de"));
}

export async function FilterBar({ filters }: { filters: ProductFilters }) {
  const [kategorien1, kategorien2, kategorien3, materialien] = await Promise.all([
    distinctValues(sourceProducts.kategorieEbene1),
    distinctValues(sourceProducts.kategorieEbene2),
    distinctValues(sourceProducts.kategorieEbene3),
    distinctValues(sourceProducts.hauptmaterial),
  ]);

  return (
    <form
      method="get"
      className="grid grid-cols-2 gap-4 rounded-lg border border-neutral-200 bg-white p-4 md:grid-cols-4 lg:grid-cols-6"
    >
      <div className="col-span-2 lg:col-span-2">
        <label className="mb-1 block text-xs font-medium text-neutral-600">Suche</label>
        <input
          type="text"
          name="q"
          defaultValue={filters.q}
          placeholder="Bezeichnung, Modell_Erweitert, EAN…"
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </div>

      <Select label="Kategorie 1" name="kategorie1" options={kategorien1} value={filters.kategorie1} />
      <Select label="Kategorie 2" name="kategorie2" options={kategorien2} value={filters.kategorie2} />
      <Select label="Kategorie 3" name="kategorie3" options={kategorien3} value={filters.kategorie3} />
      <Select label="Status" name="status" options={[...STATUS_VALUES]} labels={STATUS_LABELS} value={filters.status} />

      <div className="col-span-2 md:col-span-2">
        <label className="mb-1 block text-xs font-medium text-neutral-600">Material</label>
        <div className="flex max-h-20 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 text-xs">
          {materialien.map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="material"
                value={m}
                defaultChecked={filters.material?.includes(m)}
                className="h-3.5 w-3.5"
              />
              {m}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">UVP von / bis (€)</label>
        <div className="flex gap-1">
          <input
            type="number"
            name="priceMin"
            defaultValue={filters.priceMin}
            className="w-1/2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            name="priceMax"
            defaultValue={filters.priceMax}
            className="w-1/2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Karat von / bis</label>
        <div className="flex gap-1">
          <input
            type="number"
            step="0.01"
            name="caratMin"
            defaultValue={filters.caratMin}
            className="w-1/2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            step="0.01"
            name="caratMax"
            defaultValue={filters.caratMax}
            className="w-1/2 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input
            type="checkbox"
            name="bestand"
            value="instock"
            defaultChecked={filters.bestand === "instock"}
            className="h-3.5 w-3.5"
          />
          Nur Bestand ≥ 1
        </label>
      </div>

      <div className="col-span-2 flex items-end gap-2 md:col-span-4 lg:col-span-6">
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Filtern
        </button>
        <a href="/" className="rounded-md px-4 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100">
          Zurücksetzen
        </a>
      </div>
    </form>
  );
}

function Select({
  label,
  name,
  options,
  value,
  labels,
}: {
  label: string;
  name: string;
  options: string[];
  value?: string;
  labels?: Record<string, string>;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
      >
        <option value="">Alle</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </div>
  );
}
