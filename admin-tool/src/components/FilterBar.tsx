import Link from "next/link";
import { isNotNull } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { db } from "@/db/client";
import { sourceProducts, STATUS_VALUES } from "@/db/schema";
import { STATUS_LABELS } from "@/components/StatusBadge";
import type { ProductFilters } from "@/lib/product-query";
import { inputClass, selectClass, buttonPrimary, buttonGhost } from "@/lib/ui";

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

type Overrides = Partial<{
  q: string | undefined;
  kategorie1: string | undefined;
  kategorie2: string | undefined;
  kategorie3: string | undefined;
  status: string | undefined;
  material: string[] | undefined;
  priceMin: number | undefined;
  priceMax: number | undefined;
  caratMin: number | undefined;
  caratMax: number | undefined;
  bestand: "instock" | "all" | undefined;
}>;

function filterHref(filters: ProductFilters, overrides: Overrides) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.kategorie1) params.set("kategorie1", merged.kategorie1);
  if (merged.kategorie2) params.set("kategorie2", merged.kategorie2);
  if (merged.kategorie3) params.set("kategorie3", merged.kategorie3);
  if (merged.status) params.set("status", merged.status);
  merged.material?.forEach((m) => params.append("material", m));
  if (merged.priceMin !== undefined) params.set("priceMin", String(merged.priceMin));
  if (merged.priceMax !== undefined) params.set("priceMax", String(merged.priceMax));
  if (merged.caratMin !== undefined) params.set("caratMin", String(merged.caratMin));
  if (merged.caratMax !== undefined) params.set("caratMax", String(merged.caratMax));
  if (merged.bestand === "instock") params.set("bestand", "instock");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function buildChips(filters: ProductFilters) {
  const chips: { key: string; label: string; href: string }[] = [];

  if (filters.q) {
    chips.push({ key: "q", label: `Suche: „${filters.q}“`, href: filterHref(filters, { q: undefined }) });
  }
  if (filters.kategorie1) {
    chips.push({
      key: "kategorie1",
      label: `Kategorie 1: ${filters.kategorie1}`,
      href: filterHref(filters, { kategorie1: undefined }),
    });
  }
  if (filters.kategorie2) {
    chips.push({
      key: "kategorie2",
      label: `Kategorie 2: ${filters.kategorie2}`,
      href: filterHref(filters, { kategorie2: undefined }),
    });
  }
  if (filters.kategorie3) {
    chips.push({
      key: "kategorie3",
      label: `Kategorie 3: ${filters.kategorie3}`,
      href: filterHref(filters, { kategorie3: undefined }),
    });
  }
  if (filters.status) {
    chips.push({
      key: "status",
      label: `Status: ${STATUS_LABELS[filters.status]}`,
      href: filterHref(filters, { status: undefined }),
    });
  }
  filters.material?.forEach((m) => {
    chips.push({
      key: `material-${m}`,
      label: `Material: ${m}`,
      href: filterHref(filters, { material: filters.material!.filter((x) => x !== m) }),
    });
  });
  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    chips.push({
      key: "price",
      label: `UVP: ${filters.priceMin ?? 0}–${filters.priceMax ?? "∞"} €`,
      href: filterHref(filters, { priceMin: undefined, priceMax: undefined }),
    });
  }
  if (filters.caratMin !== undefined || filters.caratMax !== undefined) {
    chips.push({
      key: "carat",
      label: `Karat: ${filters.caratMin ?? 0}–${filters.caratMax ?? "∞"}`,
      href: filterHref(filters, { caratMin: undefined, caratMax: undefined }),
    });
  }
  if (filters.bestand === "instock") {
    chips.push({
      key: "bestand",
      label: "Nur Bestand ≥ 1",
      href: filterHref(filters, { bestand: "all" }),
    });
  }

  return chips;
}

export async function FilterBar({ filters }: { filters: ProductFilters }) {
  const [kategorien1, kategorien2, kategorien3, materialien] = await Promise.all([
    distinctValues(sourceProducts.kategorieEbene1),
    distinctValues(sourceProducts.kategorieEbene2),
    distinctValues(sourceProducts.kategorieEbene3),
    distinctValues(sourceProducts.hauptmaterial),
  ]);

  const chips = buildChips(filters);
  const isActive = chips.length > 0;

  return (
    <form
      method="get"
      className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
        isActive ? "border-indigo-200 ring-1 ring-indigo-100" : "border-zinc-200/80"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex items-center gap-1.5 ${isActive ? "text-indigo-600" : "text-zinc-500"}`}>
          <SlidersHorizontal size={14} />
          <span className="text-xs font-medium uppercase tracking-wide">Filter</span>
          {isActive && (
            <span className="ml-1 inline-flex items-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {chips.length} aktiv
            </span>
          )}
        </div>
        {isActive && (
          <Link href="/" className="text-xs font-medium text-zinc-400 hover:text-zinc-700">
            Alle zurücksetzen
          </Link>
        )}
      </div>

      {isActive && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              {chip.label}
              <X size={12} />
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <div className="col-span-2 lg:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">Suche</label>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              name="q"
              defaultValue={filters.q}
              placeholder="Bezeichnung, Modell_Erweitert, EAN…"
              className={`${inputClass} pl-8`}
            />
          </div>
        </div>

        <Select label="Kategorie 1" name="kategorie1" options={kategorien1} value={filters.kategorie1} />
        <Select label="Kategorie 2" name="kategorie2" options={kategorien2} value={filters.kategorie2} />
        <Select label="Kategorie 3" name="kategorie3" options={kategorien3} value={filters.kategorie3} />
        <Select label="Status" name="status" options={[...STATUS_VALUES]} labels={STATUS_LABELS} value={filters.status} />

        <div className="col-span-2 md:col-span-2">
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">Material</label>
          <div className="flex max-h-20 flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2 text-xs">
            {materialien.map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-zinc-600">
                <input
                  type="checkbox"
                  name="material"
                  value={m}
                  defaultChecked={filters.material?.includes(m)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                {m}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">UVP von / bis (€)</label>
          <div className="flex gap-1.5">
            <input type="number" name="priceMin" defaultValue={filters.priceMin} className={inputClass} />
            <input type="number" name="priceMax" defaultValue={filters.priceMax} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">Karat von / bis</label>
          <div className="flex gap-1.5">
            <input
              type="number"
              step="0.01"
              name="caratMin"
              defaultValue={filters.caratMin}
              className={inputClass}
            />
            <input
              type="number"
              step="0.01"
              name="caratMax"
              defaultValue={filters.caratMax}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-1.5 text-sm text-zinc-600">
            <input
              type="checkbox"
              name="bestand"
              value="instock"
              defaultChecked={filters.bestand === "instock"}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            Nur Bestand ≥ 1
          </label>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-4">
        <button type="submit" className={buttonPrimary}>
          Filtern
        </button>
        <Link href="/" className={buttonGhost}>
          Zurücksetzen
        </Link>
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
      <label className="mb-1.5 block text-xs font-medium text-zinc-500">{label}</label>
      <select name={name} defaultValue={value ?? ""} className={selectClass}>
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
