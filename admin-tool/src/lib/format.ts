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
