"use client";

import { useTransition } from "react";
import { STATUS_VALUES, type ProductStatus } from "@/db/schema";
import { STATUS_LABELS } from "@/components/StatusBadge";
import { updateProductStatus } from "@/lib/product-actions";
import { selectClass } from "@/lib/ui";

export function StatusSelect({ id, status }: { id: number; status: ProductStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value as ProductStatus;
        startTransition(async () => {
          try {
            await updateProductStatus(id, next);
          } catch (err) {
            // Sperren (z.B. "Daten unvollständig") sollen als Hinweis erscheinen, nicht die Seite
            // in die Fehleransicht werfen; Auswahl zurück auf den gespeicherten Status.
            window.alert(err instanceof Error ? err.message : String(err));
            e.target.value = status;
          }
        });
      }}
      className={`${selectClass} disabled:opacity-50`}
    >
      {STATUS_VALUES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
