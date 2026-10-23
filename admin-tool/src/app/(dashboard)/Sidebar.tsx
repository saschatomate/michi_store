"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gem, Upload, Link2, LogOut, PlusCircle, Tags, Clock, Radio } from "lucide-react";
import { logout } from "@/lib/auth-actions";
import { FilterPanel } from "@/components/FilterPanel";
import { BudgetWidget } from "@/components/BudgetWidget";
import type { FilterOptions } from "@/lib/filter-options";
import type { BudgetSummary } from "@/lib/cost-tracking";

const NAV_ITEMS = [
  { href: "/", label: "Produkte", icon: Gem },
  { href: "/products/new", label: "Eigenes Produkt anlegen", icon: PlusCircle },
  { href: "/categories", label: "Kategorien", icon: Tags },
  { href: "/availability", label: "Lieferzeiten", icon: Clock },
  { href: "/shopify-changes", label: "Shopify-Verlauf", icon: Radio },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/mapping", label: "Mapping", icon: Link2 },
];

export function Sidebar({
  filterOptions,
  budget,
  shopifyActivity,
}: {
  filterOptions: FilterOptions;
  budget: BudgetSummary;
  shopifyActivity: { changes24h: number; errors24h: number };
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-y-auto bg-white">
      <div className="flex h-20 shrink-0 items-center gap-2.5 px-7">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 font-display text-sm font-semibold text-white shadow-sm shadow-indigo-600/30">
          M
        </div>
        <span className="font-display text-lg font-semibold text-zinc-900">
          Marinell Admin
        </span>
      </div>

      <nav className="shrink-0 space-y-1 px-4 py-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                isActive
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                  : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {item.label}
              {item.href === "/shopify-changes" && (shopifyActivity.changes24h > 0 || shopifyActivity.errors24h > 0) && (
                <span className="ml-auto flex items-center gap-1">
                  {shopifyActivity.changes24h > 0 && (
                    <span
                      title="Änderungen in Richtung Shopify in den letzten 24 Stunden"
                      className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-bold text-white"
                    >
                      {shopifyActivity.changes24h}
                    </span>
                  )}
                  {shopifyActivity.errors24h > 0 && (
                    <span
                      title="Fehlgeschlagene Übertragungen in den letzten 24 Stunden"
                      className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white"
                    >
                      ⚠ {shopifyActivity.errors24h}
                    </span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-zinc-100 p-4">
        <BudgetWidget budget={budget} />
      </div>

      <div className="shrink-0 border-t border-zinc-100 p-4">
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <LogOut size={16} strokeWidth={2} />
            Abmelden
          </button>
        </form>
      </div>

      {pathname === "/" && (
        <div className="shrink-0 border-t border-zinc-100">
          <Suspense fallback={null}>
            <FilterPanel options={filterOptions} />
          </Suspense>
        </div>
      )}
    </aside>
  );
}
