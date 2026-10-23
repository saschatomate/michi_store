import type { ProductStatus } from "@/db/schema";

const STATUS_LABELS: Record<ProductStatus, string> = {
  unvollstaendig: "Daten unvollständig",
  neu: "Neu",
  ausgewaehlt: "Ausgewählt",
  in_pipeline: "In Pipeline",
  review: "Review offen",
  freigegeben: "Freigegeben",
  uebertragungsfehler: "Übertragungsfehler",
  veroeffentlicht: "Veröffentlicht",
  abgelehnt: "Abgelehnt",
  archiviert: "Archiviert",
};

const STATUS_STYLES: Record<ProductStatus, string> = {
  unvollstaendig: "bg-orange-100 text-orange-600",
  neu: "bg-sky-100 text-sky-600",
  ausgewaehlt: "bg-blue-100 text-blue-600",
  in_pipeline: "bg-amber-100 text-amber-600",
  review: "bg-violet-100 text-violet-600",
  freigegeben: "bg-cyan-100 text-cyan-700",
  uebertragungsfehler: "bg-red-100 text-red-600",
  veroeffentlicht: "bg-emerald-100 text-emerald-600",
  abgelehnt: "bg-red-100 text-red-600",
  archiviert: "bg-zinc-100 text-zinc-500",
};

// Punkt-Farben werden nicht mehr angezeigt (Pastell-Pill-Design), bleiben für mögliche Wiederverwendung erhalten.
export const STATUS_DOT: Record<ProductStatus, string> = {
  unvollstaendig: "bg-orange-500",
  neu: "bg-zinc-400",
  ausgewaehlt: "bg-blue-500",
  in_pipeline: "bg-amber-500",
  review: "bg-violet-500",
  freigegeben: "bg-sky-500",
  uebertragungsfehler: "bg-red-500",
  veroeffentlicht: "bg-emerald-500",
  abgelehnt: "bg-red-500",
  archiviert: "bg-zinc-400",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export { STATUS_LABELS };
