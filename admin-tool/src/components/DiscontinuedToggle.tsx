"use client";

import { useState, useTransition } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { setProductDiscontinued } from "@/lib/availability-actions";
import { buttonSecondary } from "@/lib/ui";

export function DiscontinuedToggle({ id, discontinued }: { id: number; discontinued: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (!discontinued && !window.confirm("Produkt als „nicht mehr lieferbar“ markieren? Es wird dann nicht mehr verkauft.")) return;
    setError(null);
    startTransition(async () => {
      try {
        await setProductDiscontinued(id, !discontinued);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div>
      <button type="button" onClick={toggle} disabled={isPending} className={buttonSecondary}>
        {discontinued ? <RotateCcw size={14} /> : <Ban size={14} />}
        {discontinued ? "Wieder als lieferbar markieren" : "Als nicht mehr lieferbar markieren"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
