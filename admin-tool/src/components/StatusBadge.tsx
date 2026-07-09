import type { ProductStatus } from "@/db/schema";

const STATUS_LABELS: Record<ProductStatus, string> = {
  neu: "Neu",
  ausgewaehlt: "Ausgewählt",
  in_pipeline: "In Pipeline",
  review: "Review offen",
  veroeffentlicht: "Veröffentlicht",
  abgelehnt: "Abgelehnt",
  archiviert: "Archiviert",
};

const STATUS_STYLES: Record<ProductStatus, string> = {
  neu: "bg-neutral-100 text-neutral-700",
  ausgewaehlt: "bg-blue-100 text-blue-700",
  in_pipeline: "bg-amber-100 text-amber-700",
  review: "bg-purple-100 text-purple-700",
  veroeffentlicht: "bg-green-100 text-green-700",
  abgelehnt: "bg-red-100 text-red-700",
  archiviert: "bg-neutral-200 text-neutral-500",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export { STATUS_LABELS };
