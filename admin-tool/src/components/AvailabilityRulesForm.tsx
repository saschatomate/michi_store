"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { updateAvailabilityRule } from "@/lib/availability-actions";
import { buttonPrimary, cardClass, inputClass } from "@/lib/ui";
import type { AvailabilityRule } from "@/lib/availability";

const ROWS = [
  { key: "in_stock", label: "Lagerware", hint: "Stück liegt bei DG in Koblenz (Bestand > 0)" },
  { key: "lab_grown", label: "Anfertigung – Labordiamant", hint: "Bestand 0 oder andere Ringgröße" },
  { key: "natural", label: "Anfertigung – Naturdiamant", hint: "Gilt auch, wenn die Steinherkunft unbekannt ist" },
  { key: "shipping", label: "Versand nach Fertigstellung", hint: "Innerhalb Deutschlands" },
] as const;

const UNIT_LABEL: Record<AvailabilityRule["unit"], string> = { days: "Tage", weeks: "Wochen", workdays: "Werktage" };

function RuleRow({ rowKey, label, hint, rule }: { rowKey: string; label: string; hint: string; rule: AvailabilityRule }) {
  const [min, setMin] = useState(String(rule.min));
  const [max, setMax] = useState(String(rule.max));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dirty = min !== String(rule.min) || max !== String(rule.max);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateAvailabilityRule(rowKey, Number(min), Number(max));
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-56 flex-1">
        <div className="text-sm font-medium text-zinc-900">{label}</div>
        <div className="text-xs text-zinc-500">{hint}</div>
      </div>
      <div className="flex items-center gap-2 text-sm text-zinc-600">
        <input className={`${inputClass} w-16`} inputMode="numeric" value={min} onChange={(e) => { setMin(e.target.value); setSaved(false); }} />
        –
        <input className={`${inputClass} w-16`} inputMode="numeric" value={max} onChange={(e) => { setMax(e.target.value); setSaved(false); }} />
        {UNIT_LABEL[rule.unit]}
      </div>
      <button onClick={save} disabled={isPending || !dirty} className={buttonPrimary}>
        Speichern
      </button>
      {saved && !dirty && (
        <span className="flex items-center gap-1 text-sm text-emerald-700">
          <CheckCircle2 size={14} />
          Gespeichert
        </span>
      )}
      {error && <span className="basis-full text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function AvailabilityRulesForm({ rules }: { rules: Record<string, AvailabilityRule> }) {
  return (
    <div className={`${cardClass} divide-y divide-zinc-100`}>
      {ROWS.map((r) => (
        <RuleRow key={r.key} rowKey={r.key} label={r.label} hint={r.hint} rule={rules[r.key]} />
      ))}
    </div>
  );
}
