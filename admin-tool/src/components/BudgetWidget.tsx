"use client";

import { useState, useTransition } from "react";
import { Pencil, Wallet, X } from "lucide-react";
import { updateTotalBudget } from "@/lib/budget-actions";
import { formatUsd } from "@/lib/format";
import { buttonGhost, buttonPrimary, inputClass } from "@/lib/ui";
import type { BudgetSummary } from "@/lib/cost-tracking";

// Zeigt das manuell gepflegte Gesamtbudget für Claude+OpenAI-Aufrufe und was davon bereits
// verbraucht ist (siehe cost-tracking.ts - weder Anthropic noch OpenAI bieten für normale API-Keys
// einen Guthaben-Endpoint, daher die eigene Buchhaltung). Der Stift öffnet eine Inline-Eingabe für
// das Gesamtbudget; der verbrauchte Betrag selbst ist nicht editierbar, er ergibt sich aus den
// tatsächlich geloggten API-Aufrufen.
export function BudgetWidget({ budget }: { budget: BudgetSummary }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(String(budget.totalBudgetUsd));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasBudget = budget.totalBudgetUsd > 0;
  const ratio = hasBudget ? Math.min(1, Math.max(0, budget.spentUsd / budget.totalBudgetUsd)) : 0;
  const barColor = ratio >= 0.9 ? "bg-red-500" : ratio >= 0.7 ? "bg-amber-500" : "bg-emerald-500";

  function startEdit() {
    setDraft(String(budget.totalBudgetUsd));
    setError(null);
    setIsEditing(true);
  }

  function save() {
    const amount = Number(draft.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Bitte eine gültige Zahl ≥ 0 eingeben.");
      return;
    }
    setError(null);
    startTransition(async () => {
      await updateTotalBudget(amount);
      setIsEditing(false);
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <Wallet size={13} />
          API-Budget
        </span>
        {!isEditing && (
          <button
            onClick={startEdit}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
            aria-label="Budget bearbeiten"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-500">$</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={isPending}
              autoFocus
              inputMode="decimal"
              className={`${inputClass} px-2 py-1 text-xs`}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-1.5">
            <button onClick={save} disabled={isPending} className={`${buttonPrimary} flex-1 px-2 py-1 text-xs`}>
              {isPending ? "Speichere…" : "Speichern"}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              disabled={isPending}
              className={`${buttonGhost} px-2 py-1 text-xs`}
              aria-label="Abbrechen"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : hasBudget ? (
        <>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
            <div className={`h-full ${barColor}`} style={{ width: `${ratio * 100}%` }} />
          </div>
          <div className="flex items-baseline justify-between">
            <span
              className={`text-sm font-semibold ${budget.remainingUsd < 0 ? "text-red-600" : "text-zinc-900"}`}
            >
              {formatUsd(budget.remainingUsd)}
            </span>
            <span className="text-xs text-zinc-500">verbleibend</span>
          </div>
          <p className="text-xs text-zinc-500">
            {formatUsd(budget.spentUsd)} von {formatUsd(budget.totalBudgetUsd)} verbraucht
          </p>
        </>
      ) : (
        <p className="text-xs text-zinc-500">
          Kein Budget gesetzt - bisher {formatUsd(budget.spentUsd)} ausgegeben.
        </p>
      )}
    </div>
  );
}
