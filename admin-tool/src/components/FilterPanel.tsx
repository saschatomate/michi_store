"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { STATUS_VALUES } from "@/db/schema";
import { STATUS_LABELS } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { parseFilters, type ProductFilters } from "@/lib/product-query";
import type { FilterOptions } from "@/lib/filter-options";
import { inputClass, selectClass, buttonPrimary, buttonGhost } from "@/lib/ui";

const BESTAND_THRESHOLDS = [1, 2, 5];

function searchParamsToRaw(sp: URLSearchParams): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(sp.keys())) {
    const values = sp.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  return raw;
}

type Overrides = Partial<{
  q: string | undefined;
  kategorie1: string | undefined;
  kategorie2: string | undefined;
  kategorie3: string | undefined;
  status: string | undefined;
  material: string[] | undefined;
  legierung: string[] | undefined;
  priceMin: number | undefined;
  priceMax: number | undefined;
  caratMin: number | undefined;
  caratMax: number | undefined;
  bestandMin: number | undefined;
  importRunId: number | undefined;
  newArrivalOnly: boolean | undefined;
  missingOnly: boolean | undefined;
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
  merged.legierung?.forEach((l) => params.append("legierung", l));
  if (merged.priceMin !== undefined) params.set("priceMin", String(merged.priceMin));
  if (merged.priceMax !== undefined) params.set("priceMax", String(merged.priceMax));
  if (merged.caratMin !== undefined) params.set("caratMin", String(merged.caratMin));
  if (merged.caratMax !== undefined) params.set("caratMax", String(merged.caratMax));
  if (merged.bestandMin !== undefined) params.set("bestandMin", String(merged.bestandMin));
  if (merged.importRunId !== undefined) params.set("importRunId", String(merged.importRunId));
  if (merged.newArrivalOnly) params.set("newArrivalOnly", "1");
  if (merged.missingOnly) params.set("missingOnly", "1");
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function buildChips(filters: ProductFilters, importRunLabel: string | null) {
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
  filters.legierung?.forEach((l) => {
    chips.push({
      key: `legierung-${l}`,
      label: `Legierung: ${l}`,
      href: filterHref(filters, { legierung: filters.legierung!.filter((x) => x !== l) }),
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
  if (filters.bestandMin !== undefined) {
    chips.push({
      key: "bestand",
      label: `Bestand ≥ ${filters.bestandMin}`,
      href: filterHref(filters, { bestandMin: undefined }),
    });
  }
  if (filters.importRunId !== undefined) {
    chips.push({
      key: "importRun",
      label: `Import: ${importRunLabel ?? `Lauf #${filters.importRunId}`}`,
      href: filterHref(filters, { importRunId: undefined }),
    });
  }
  if (filters.newArrivalOnly) {
    chips.push({
      key: "newArrivalOnly",
      label: "Neu erschienen",
      href: filterHref(filters, { newArrivalOnly: undefined }),
    });
  }
  if (filters.missingOnly) {
    chips.push({
      key: "missingOnly",
      label: "Nicht mehr im Bestand",
      href: filterHref(filters, { missingOnly: undefined }),
    });
  }

  return chips;
}

export function FilterPanel({ options }: { options: FilterOptions }) {
  const searchParams = useSearchParams();
  const filters = parseFilters(searchParamsToRaw(searchParams));
  const { kategorien1, kategorien2, kategorien3, materialien, legierungen, runs } = options;

  const runLabels = Object.fromEntries(
    runs.map((r) => [String(r.id), `${r.filename} — ${formatDateTime(r.startedAt)}`]),
  );
  const importRunLabel =
    filters.importRunId !== undefined ? (runLabels[String(filters.importRunId)] ?? null) : null;

  const chips = buildChips(filters, importRunLabel);
  const isActive = chips.length > 0;

  return (
    <form method="get" action="/" className="p-5">
      <div className="mb-4 flex items-center justify-between">
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
        <div className="mb-5 flex flex-wrap gap-1.5">
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

      {/* Suche steht bewusst prominent und für sich - der schnellste Weg, ein Produkt zu finden */}
      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-medium text-zinc-500">Suche</label>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder="Bezeichnung, Modell_Erweitert, EAN…"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      <div className="space-y-5">
        <FilterGroup title="Kategorisierung">
          <div className="space-y-3">
            <Select label="Kategorie 1" name="kategorie1" options={kategorien1} value={filters.kategorie1} />
            <Select label="Kategorie 2" name="kategorie2" options={kategorien2} value={filters.kategorie2} />
            <Select label="Kategorie 3" name="kategorie3" options={kategorien3} value={filters.kategorie3} />
            <Select label="Status" name="status" options={[...STATUS_VALUES]} labels={STATUS_LABELS} value={filters.status} />
          </div>
        </FilterGroup>

        <FilterGroup title="Material">
          <div className="space-y-4">
            <CheckboxGroup label="Material" name="material" options={materialien} selected={filters.material} />
            <CheckboxGroup label="Legierung" name="legierung" options={legierungen} selected={filters.legierung} />
          </div>
        </FilterGroup>

        <FilterGroup title="Preis, Karat & Verfügbarkeit">
          <div className="space-y-3">
            <RangeInputs label="UVP von / bis (€)" nameMin="priceMin" nameMax="priceMax" valueMin={filters.priceMin} valueMax={filters.priceMax} />
            <RangeInputs
              label="Karat von / bis"
              nameMin="caratMin"
              nameMax="caratMax"
              valueMin={filters.caratMin}
              valueMax={filters.caratMax}
              step="0.01"
            />
            <Select
              label="Bestand"
              name="bestandMin"
              options={BESTAND_THRESHOLDS.map(String)}
              labels={Object.fromEntries(BESTAND_THRESHOLDS.map((n) => [String(n), `≥ ${n}`]))}
              value={filters.bestandMin?.toString()}
            />
            <Select
              label="Neu aus Import"
              name="importRunId"
              options={runs.map((r) => String(r.id))}
              labels={runLabels}
              value={filters.importRunId?.toString()}
            />
          </div>
        </FilterGroup>

        <FilterGroup title="Neuheiten & Verfügbarkeit">
          <div className="flex flex-col gap-2">
            <BooleanFilter
              label="Nur neu erschienene Produkte"
              name="newArrivalOnly"
              checked={filters.newArrivalOnly ?? false}
            />
            <BooleanFilter
              label="Nur nicht mehr im Bestand"
              name="missingOnly"
              checked={filters.missingOnly ?? false}
            />
          </div>
        </FilterGroup>
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t border-zinc-100 pt-5">
        <button type="submit" className={`${buttonPrimary} w-full`}>
          Filtern
        </button>
        <Link href="/" className={`${buttonGhost} w-full`}>
          Zurücksetzen
        </Link>
      </div>
    </form>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-5 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      {children}
    </div>
  );
}

function CheckboxGroup({
  label,
  name,
  options,
  selected,
}: {
  label: string;
  name: string;
  options: string[];
  selected?: string[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-500">{label}</label>
      <div className="flex max-h-24 flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto rounded-md border border-zinc-200 p-2.5 text-xs">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-zinc-600">
            <input
              type="checkbox"
              name={name}
              value={o}
              defaultChecked={selected?.includes(o)}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            {o}
          </label>
        ))}
      </div>
    </div>
  );
}

function BooleanFilter({ label, name, checked }: { label: string; name: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
      />
      {label}
    </label>
  );
}

function RangeInputs({
  label,
  nameMin,
  nameMax,
  valueMin,
  valueMax,
  step,
}: {
  label: string;
  nameMin: string;
  nameMax: string;
  valueMin?: number;
  valueMax?: number;
  step?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-500">{label}</label>
      <div className="flex gap-1.5">
        <input type="number" step={step} name={nameMin} defaultValue={valueMin} placeholder="von" className={inputClass} />
        <input type="number" step={step} name={nameMax} defaultValue={valueMax} placeholder="bis" className={inputClass} />
      </div>
    </div>
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
