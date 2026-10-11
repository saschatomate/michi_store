import { ACTOR_LABEL, SHOPIFY_ACTION_LABEL, type ShopifyAction, type ShopifyChanges } from "@/lib/shopify-changes";
import { formatDateTime } from "@/lib/format";

export function ShopifyChangeDetails({ changes }: { changes: ShopifyChanges | null }) {
  if (!changes) return null;
  return (
    <ul className="mt-0.5 space-y-0.5 text-xs text-zinc-700">
      {Object.entries(changes).map(([field, c]) => (
        <li key={field}>
          <span className="font-semibold">{field}:</span>{" "}
          {c.from !== null && c.from !== undefined && <span className="text-zinc-500 line-through decoration-zinc-300">{String(c.from)}</span>}
          {c.from !== null && c.from !== undefined && " → "}
          <span className="font-medium text-zinc-900">{String(c.to)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ShopifyEventHeader({ action, actor, createdAt }: { action: string; actor: string; createdAt: Date }) {
  const isError = action === "shopify_error";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`rounded px-1.5 py-0.5 font-bold uppercase tracking-wide text-white ${
          isError ? "bg-red-600" : action === "shopify_created" ? "bg-emerald-600" : action === "shopify_archived" ? "bg-zinc-700" : "bg-orange-500"
        }`}
      >
        {SHOPIFY_ACTION_LABEL[action as ShopifyAction] ?? action}
      </span>
      <span className="text-zinc-500">
        {formatDateTime(createdAt)} · {ACTOR_LABEL[actor] ?? actor}
      </span>
    </div>
  );
}
