"use client";

import { useTransition } from "react";
import { STATUS_VALUES, type ProductStatus } from "@/db/schema";
import { STATUS_LABELS } from "@/components/StatusBadge";
import { updateProductStatus } from "@/lib/product-actions";

export function StatusSelect({ id, status }: { id: number; status: ProductStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={isPending}
      onChange={(e) => startTransition(() => updateProductStatus(id, e.target.value as ProductStatus))}
      className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm disabled:opacity-50"
    >
      {STATUS_VALUES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
