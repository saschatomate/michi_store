"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteShopifyError, deleteShopifyErrorsOlderThan } from "@/lib/shopify-actions";
import { buttonSecondary, selectClass } from "@/lib/ui";

export function DeleteErrorButton({ eventId }: { eventId: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Fehlermeldung löschen"
      disabled={pending}
      onClick={() => start(() => deleteShopifyError(eventId))}
      className="ml-auto rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 size={14} />
    </button>
  );
}

export function BulkDeleteErrors() {
  const [days, setDays] = useState("7");
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    const n = Number(days);
    const label = n === 0 ? "alle Fehlermeldungen" : `Fehlermeldungen älter als ${n} Tage`;
    if (!window.confirm(`${label} endgültig löschen?`)) return;
    start(async () => {
      const { deleted } = await deleteShopifyErrorsOlderThan(n);
      setResult(`${deleted} gelöscht.`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
      <span>Fehlermeldungen löschen, die älter sind als</span>
      <select value={days} onChange={(e) => setDays(e.target.value)} className={`${selectClass} !w-auto !py-1.5`}>
        <option value="1">1 Tag</option>
        <option value="7">7 Tage</option>
        <option value="30">30 Tage</option>
        <option value="0">alle</option>
      </select>
      <button type="button" onClick={run} disabled={pending} className={buttonSecondary}>
        <Trash2 size={14} /> Löschen
      </button>
      {result && <span className="text-zinc-500">{result}</span>}
    </div>
  );
}
