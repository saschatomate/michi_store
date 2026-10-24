"use client";

import { useState, useTransition } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { createCategory, deleteCategory, moveCategory, updateCategory } from "@/lib/category-actions";
import { parseProductTypeRule } from "@/lib/category-rules";
import { STONE_ORIGIN_LABELS } from "@/lib/custom-product";
import { buttonGhost, buttonPrimary, buttonSecondary, cardClass, inputClass, selectClass } from "@/lib/ui";
import type { CategoryOption } from "@/lib/categories";
import type { StoneOrigin } from "@/db/schema";

type Draft = {
  id: number | null; // null = neu
  name: string;
  parentId: number | null;
  active: boolean;
  ruleStoneOrigin: StoneOrigin | "";
  ruleProductType: string[];
  introText: string;
};

export function CategoryManager({
  categories,
  productCounts,
  productTypes,
}: {
  categories: CategoryOption[];
  productCounts: Record<number, number>;
  productTypes: { key: string; label: string }[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const typeLabel = (key: string) => productTypes.find((t) => t.key === key)?.label ?? key;

  function run(task: () => Promise<void>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await task();
        after?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function startNew(parentId: number | null) {
    setDraft({ id: null, name: "", parentId, active: true, ruleStoneOrigin: "", ruleProductType: [], introText: "" });
    setError(null);
  }

  function startEdit(c: CategoryOption) {
    setDraft({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
      active: c.active,
      ruleStoneOrigin: c.ruleStoneOrigin ?? "",
      ruleProductType: parseProductTypeRule(c.ruleProductType),
      introText: c.introText ?? "",
    });
    setError(null);
  }

  function save() {
    if (!draft) return;
    const input = {
      name: draft.name,
      parentId: draft.parentId,
      ruleStoneOrigin: draft.ruleStoneOrigin,
      ruleProductType: draft.ruleProductType,
      introText: draft.introText,
    };
    run(
      () => (draft.id === null ? createCategory(input) : updateCategory(draft.id, { ...input, active: draft.active })),
      () => setDraft(null),
    );
  }

  // Beim Bearbeiten dürfen die Kategorie selbst und ihre Nachfahren nicht als Eltern gewählt werden
  // (der Server prüft das zusätzlich).
  function descendantIds(id: number): Set<number> {
    const out = new Set<number>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parentId !== null && out.has(c.parentId) && !out.has(c.id)) {
          out.add(c.id);
          grew = true;
        }
      }
    }
    return out;
  }
  const blockedParents = draft?.id != null ? descendantIds(draft.id) : new Set<number>();

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className={`${cardClass} divide-y divide-zinc-100`}>
        {categories.map((c) => {
          const siblings = categories.filter((o) => o.parentId === c.parentId);
          const index = siblings.findIndex((o) => o.id === c.id);
          const count = productCounts[c.id] ?? 0;
          const types = parseProductTypeRule(c.ruleProductType);
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 px-4 py-2.5"
              style={{ paddingLeft: `${16 + c.depth * 24}px` }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-sm font-medium ${c.active ? "text-zinc-900" : "text-zinc-400 line-through"}`}>
                    {c.name}
                  </span>
                  {!c.active && (
                    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">
                      INAKTIV
                    </span>
                  )}
                  {c.ruleStoneOrigin && (
                    <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      {STONE_ORIGIN_LABELS[c.ruleStoneOrigin]}
                    </span>
                  )}
                  {c.introText && (
                    <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      Intro-Text
                    </span>
                  )}
                  {types.length > 0 && (
                    <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                      {types.map(typeLabel).join(", ")}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-zinc-400">
                  {c.slug} · {count} Produkt{count === 1 ? "" : "e"}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  disabled={isPending || index === 0}
                  onClick={() => run(() => moveCategory(c.id, -1))}
                  title="Nach oben"
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  disabled={isPending || index === siblings.length - 1}
                  onClick={() => run(() => moveCategory(c.id, 1))}
                  title="Nach unten"
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button onClick={() => startNew(c.id)} title="Unterkategorie anlegen" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100">
                  <Plus size={14} />
                </button>
                <button onClick={() => startEdit(c)} title="Bearbeiten" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100">
                  <Pencil size={14} />
                </button>
                <button
                  disabled={isPending}
                  onClick={() => {
                    if (window.confirm(`Kategorie „${c.name}“ wirklich löschen?`)) run(() => deleteCategory(c.id));
                  }}
                  title="Löschen"
                  className="rounded p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {categories.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-400">Noch keine Kategorien.</p>}
      </div>

      {!draft && (
        <button onClick={() => startNew(null)} className={buttonSecondary}>
          <Plus size={15} />
          Hauptkategorie anlegen
        </button>
      )}

      {draft && (
        <section className={`${cardClass} space-y-3 p-4`}>
          <h2 className="text-sm font-semibold text-zinc-900">
            {draft.id === null ? "Neue Kategorie" : "Kategorie bearbeiten"}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Name</span>
              <input className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Übergeordnet</span>
              <select
                className={selectClass}
                value={draft.parentId ?? ""}
                onChange={(e) => setDraft({ ...draft, parentId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">– Hauptkategorie –</option>
                {categories
                  .filter((c) => !blockedParents.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Regel: Labor/Natur (optional)</span>
              <select
                className={selectClass}
                value={draft.ruleStoneOrigin}
                onChange={(e) => setDraft({ ...draft, ruleStoneOrigin: e.target.value as Draft["ruleStoneOrigin"] })}
              >
                <option value="">– egal –</option>
                {Object.entries(STONE_ORIGIN_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="mb-1 block text-xs font-medium text-zinc-600">Regel: Schmuckart (optional)</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {productTypes.map((t) => (
                  <label key={t.key} className="flex items-center gap-1.5 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={draft.ruleProductType.includes(t.key)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          ruleProductType: draft.ruleProductType.includes(t.key)
                            ? draft.ruleProductType.filter((k) => k !== t.key)
                            : [...draft.ruleProductType, t.key],
                        })
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-300 accent-indigo-600"
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Intro-Text für den Shop (optional) - steht bei jedem Produkt dieser Kategorie am Anfang der
                Beschreibung, darunter folgen die Produktdaten
              </span>
              <textarea
                className={inputClass}
                rows={4}
                value={draft.introText}
                onChange={(e) => setDraft({ ...draft, introText: e.target.value })}
              />
            </label>
            {draft.id !== null && (
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-indigo-600"
                />
                Aktiv (im Editor auswählbar)
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={isPending} className={buttonPrimary}>
              {isPending ? "Speichere…" : "Speichern"}
            </button>
            <button onClick={() => setDraft(null)} className={buttonGhost}>
              Abbrechen
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
