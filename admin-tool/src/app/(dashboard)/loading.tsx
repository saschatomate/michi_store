export default function Loading() {
  return (
    <div className="max-w-5xl space-y-4" aria-busy="true" aria-label="Lädt">
      <div className="skeleton h-9 w-64 rounded-xl" />
      <div className="skeleton h-4 w-96 max-w-full rounded-lg" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-16 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
