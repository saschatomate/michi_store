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
  neu: "bg-zinc-100 text-zinc-600",
  ausgewaehlt: "bg-blue-50 text-blue-700",
  in_pipeline: "bg-amber-50 text-amber-700",
  review: "bg-violet-50 text-violet-700",
  veroeffentlicht: "bg-emerald-50 text-emerald-700",
  abgelehnt: "bg-red-50 text-red-700",
  archiviert: "bg-zinc-100 text-zinc-500",
};

const STATUS_DOT: Record<ProductStatus, string> = {
  neu: "bg-zinc-400",
  ausgewaehlt: "bg-blue-500",
  in_pipeline: "bg-amber-500",
  review: "bg-violet-500",
  veroeffentlicht: "bg-emerald-500",
  abgelehnt: "bg-red-500",
  archiviert: "bg-zinc-400",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export { STATUS_LABELS };
