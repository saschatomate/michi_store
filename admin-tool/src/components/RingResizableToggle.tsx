"use client";

import { useState, useTransition } from "react";
import { setRingResizable } from "@/lib/availability-actions";

export function RingResizableToggle({ id, resizable }: { id: number; resizable: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Sofort umspringen, ohne auf das Neuladen der Seite zu warten; bei Fehler zurück auf den Serverwert.
  const [value, setValue] = useState(resizable);
  const [prevProp, setPrevProp] = useState(resizable);
  if (resizable !== prevProp) {
    setPrevProp(resizable);
    setValue(resizable);
  }

  function change(next: boolean) {
    setError(null);
    setValue(next);
    startTransition(async () => {
      try {
        await setRingResizable(id, next);
      } catch (err) {
        setValue(!next);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-zinc-800">
        <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} />
        In der Größe änderbar
      </label>
      <p className="mt-1 text-[11px] text-zinc-400">
        Aktiv: Nachbargrößen (±2) sind als Lagerware lieferbar. Aus: nur die eine Lagergröße (z.B. Pavé, Memoire).
        Gilt nach der nächsten Übertragung zu Shopify.
      </p>
      {isPending && <p className="mt-1 text-xs text-zinc-500">Wird gespeichert …</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
