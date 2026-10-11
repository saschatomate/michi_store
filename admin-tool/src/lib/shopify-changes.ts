// Bewusst ohne "server-only": wird von Server-Seiten UND Client-Komponenten (Badges) genutzt.
//
// Shopify-Verlauf: bei jeder Übertragung wird ein lesbarer Stand (Snapshot) gespeichert. Aus dem
// Vergleich mit dem vorherigen Stand entsteht der Verlaufseintrag "Preis: 2490 -> 2590" im
// Änderungsprotokoll (product_audit_log, action "shopify_*").

export type ShopifySnapshot = {
  title: string;
  price: string;
  leadTime: string;
  sizes: string[];
  images: number;
  tags: string[];
  body: string; // Beschreibungstext ohne Lieferzeit-Absatz (der steckt in "leadTime")
  shopStatus: string; // draft | active | archived
};

export type ShopifyChanges = Record<string, { from: unknown; to: unknown }>;

const TEXT_PREVIEW = 120;
const preview = (text: string) => (text.length > TEXT_PREVIEW ? `${text.slice(0, TEXT_PREVIEW)}…` : text) || "(leer)";

export const SHOP_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  active: "live",
  archived: "archiviert",
};

export function diffSnapshots(prev: ShopifySnapshot | null, next: ShopifySnapshot): ShopifyChanges {
  if (!prev) return {};
  const changes: ShopifyChanges = {};
  if (prev.price !== next.price) changes["Preis"] = { from: prev.price, to: next.price };
  if (prev.leadTime !== next.leadTime) changes["Lieferzeit"] = { from: prev.leadTime, to: next.leadTime };
  if (prev.title !== next.title) changes["Titel"] = { from: prev.title, to: next.title };
  if (prev.body !== next.body) changes["Beschreibung"] = { from: preview(prev.body), to: preview(next.body) };
  if (prev.sizes.join(",") !== next.sizes.join(",")) {
    changes["Ringgrößen"] = { from: prev.sizes.join(", ") || "–", to: next.sizes.join(", ") || "–" };
  }
  if (prev.images !== next.images) changes["Bilder"] = { from: `${prev.images} Stück`, to: `${next.images} Stück` };
  if (prev.tags.join("|") !== next.tags.join("|")) {
    const added = next.tags.filter((t) => !prev.tags.includes(t));
    const removed = prev.tags.filter((t) => !next.tags.includes(t));
    changes["Kategorien/Tags"] = { from: removed.join(", ") || "–", to: added.join(", ") || "–" };
  }
  if (prev.shopStatus !== next.shopStatus) {
    changes["Shopify-Status"] = {
      from: SHOP_STATUS_LABEL[prev.shopStatus] ?? prev.shopStatus,
      to: SHOP_STATUS_LABEL[next.shopStatus] ?? next.shopStatus,
    };
  }
  return changes;
}

export const SHOPIFY_ACTIONS = ["shopify_created", "shopify_updated", "shopify_archived", "shopify_error"] as const;
export type ShopifyAction = (typeof SHOPIFY_ACTIONS)[number];

export const SHOPIFY_ACTION_LABEL: Record<ShopifyAction, string> = {
  shopify_created: "In Shopify angelegt",
  shopify_updated: "In Shopify geändert",
  shopify_archived: "In Shopify archiviert",
  shopify_error: "Übertragung fehlgeschlagen",
};

export const ACTOR_LABEL: Record<string, string> = {
  admin: "manuell",
  cron: "Nachtjob (automatisch)",
};

export function summarizeChanges(changes: ShopifyChanges | null | undefined): string {
  const keys = Object.keys(changes ?? {});
  return keys.length > 0 ? keys.join(", ") : "";
}

// "Frisch geändert": solange gilt ein Produkt als auffällig markiert.
export const RECENT_CHANGE_HOURS = 72;
export function isRecent(date: Date | null | undefined, hours = RECENT_CHANGE_HOURS): boolean {
  return !!date && Date.now() - date.getTime() < hours * 3_600_000;
}
