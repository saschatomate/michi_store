const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Europe/Berlin",
});

export function formatDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateTimeFormatter.format(date);
}

// Beide APIs rechnen in USD ab; Beträge unter $1 (Einzelkosten pro Generierung liegen meist im
// Cent-Bereich) bekommen eine Nachkommastelle mehr, damit "Pi mal Daumen"-Kosten nicht auf $0,00
// gerundet werden.
export function formatUsd(value: number): string {
  const decimals = Math.abs(value) < 1 ? 3 : 2;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
