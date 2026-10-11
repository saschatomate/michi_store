// Bewusst ohne "server-only": wird auch direkt aus Standalone-Skripten heraus aufgerufen (siehe
// scripts/tmp-shopify-test-upload.ts), nicht nur aus Server Components/Actions - wie csv-import.ts.
//
// Custom App über Shopifys Dev Dashboard (seit 1.1.2026 der einzige Weg - der alte, im
// Shopify-Admin selbst angelegte Custom-App-Flow mit statisch angezeigtem "Admin API access
// token" (shpat_...) wurde abgeschafft, siehe shopify.dev/docs/apps/build/dev-dashboard/
// get-api-access-tokens). Es gibt daher kein permanentes Token mehr zu kopieren - stattdessen
// werden SHOPIFY_CLIENT_ID + SHOPIFY_API_KEY (das App-Secret, Präfix shpss_) per
// Client-Credentials-Grant (POST /admin/oauth/access_token) gegen ein 24h gültiges Access Token
// getauscht, das dieses Modul unten in-memory cached und automatisch erneuert. Funktioniert nur,
// wenn App und Shop in derselben Shopify-Organisation liegen (bei uns der Fall: eigene App für die
// eigene Filiale).
const DEFAULT_API_VERSION = "2025-01";
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

function shopDomain(): string {
  const raw = process.env.SHOPIFY_SHOP_DOMAIN;
  if (!raw) {
    throw new Error(
      "SHOPIFY_SHOP_DOMAIN ist nicht gesetzt (.env.local prüfen, z.B. marinell.myshopify.com).",
    );
  }
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function clientId(): string {
  const value = process.env.SHOPIFY_CLIENT_ID;
  if (!value) throw new Error("SHOPIFY_CLIENT_ID ist nicht gesetzt (.env.local prüfen).");
  return value;
}

function clientSecret(): string {
  const value = process.env.SHOPIFY_API_KEY;
  if (!value) throw new Error("SHOPIFY_API_KEY (App-Secret, shpss_...) ist nicht gesetzt (.env.local prüfen).");
  return value;
}

function apiVersion(): string {
  return process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function fetchAccessToken(): Promise<string> {
  const url = `https://${shopDomain()}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId(),
      client_secret: clientSecret(),
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify-Token-Austausch fehlgeschlagen (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cachedToken.accessToken;
  }
  return fetchAccessToken();
}

async function shopifyRequest<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const url = `https://${shopDomain()}/admin/api/${apiVersion()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": await accessToken(),
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Shopify-Antwort (${res.status}) war kein JSON: ${text.slice(0, 500)}`);
    }
  }

  if (!res.ok) {
    const detail = parsed ? JSON.stringify(parsed) : text;
    throw new Error(`Shopify API-Fehler ${res.status} ${res.statusText} bei ${method} ${path}: ${detail}`);
  }

  return parsed as T;
}

// GraphQL Admin API (für alles Neue; die REST-Produkt-API oben ist Legacy und bleibt nur für den
// bestehenden Verbindungstest). Gibt bei GraphQL-Fehlern (errors[]) eine Exception mit Details.
export async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const url = `https://${shopDomain()}/admin/api/${apiVersion()}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": await accessToken(), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shopify GraphQL-Fehler ${res.status}: ${text.slice(0, 500)}`);
  const parsed = JSON.parse(text) as { data?: T; errors?: unknown };
  if (parsed.errors) throw new Error(`Shopify GraphQL-Fehler: ${JSON.stringify(parsed.errors).slice(0, 800)}`);
  return parsed.data as T;
}

export type ShopifyImageInput = { src: string };

export type ShopifyVariantInput = {
  price: string;
  sku?: string;
  barcode?: string;
  inventory_management?: "shopify" | null;
  inventory_policy?: "deny" | "continue";
  inventory_quantity?: number;
};

export type ShopifyProductInput = {
  title: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status: "draft" | "active" | "archived";
  images?: ShopifyImageInput[];
  variants?: ShopifyVariantInput[];
};

export type ShopifyProduct = {
  id: number;
  admin_graphql_api_id: string;
  handle: string;
  title: string;
  status: string;
};

// Günstigster Weg, Shop-Domain + Access Token zu prüfen, bevor man einen echten Schreib-Request
// (Produkt anlegen) riskiert - liest nur den Shop-Namen, keine Nebenwirkungen.
export async function testShopifyConnection(): Promise<{ name: string; domain: string }> {
  const data = await shopifyRequest<{ shop: { name: string; myshopify_domain: string } }>("GET", "/shop.json");
  return { name: data.shop.name, domain: data.shop.myshopify_domain };
}

export async function createShopifyProduct(input: ShopifyProductInput): Promise<ShopifyProduct> {
  const data = await shopifyRequest<{ product: ShopifyProduct }>("POST", "/products.json", { product: input });
  return data.product;
}

export async function getShopifyProduct(id: number): Promise<ShopifyProduct> {
  const data = await shopifyRequest<{ product: ShopifyProduct }>("GET", `/products/${id}.json`);
  return data.product;
}

export async function deleteShopifyProduct(id: number): Promise<void> {
  await shopifyRequest<unknown>("DELETE", `/products/${id}.json`);
}

export function shopifyAdminProductUrl(id: number): string {
  return `https://${shopDomain()}/admin/products/${id}`;
}

// --- GraphQL-Bausteine für die Produktübertragung (siehe shopify-sync.ts) ----------------------

export type ShopifyUserError = { field?: string[] | null; message: string };

function throwOnUserErrors(context: string, errors: ShopifyUserError[] | undefined) {
  if (errors && errors.length > 0) {
    throw new Error(`${context}: ${errors.map((e) => `${e.field?.join(".") ?? ""} ${e.message}`.trim()).join(" | ")}`);
  }
}

export type ProductSetResult = {
  id: string;
  handle: string;
  status: string;
  variants: { id: string; sku: string | null }[];
};

// productSet legt an (ohne identifier) oder aktualisiert (mit identifier.id) in einem Aufruf -
// Optionen, Varianten, Metafields, Medien und Kollektionen inklusive. synchronous: Ergebnis liegt
// vor, wenn die Antwort kommt.
export async function shopifyProductSet(
  input: Record<string, unknown>,
  existingId: string | null,
): Promise<ProductSetResult> {
  const data = await shopifyGraphql<{
    productSet: {
      product: { id: string; handle: string; status: string; variants: { nodes: { id: string; sku: string | null }[] } } | null;
      userErrors: ShopifyUserError[];
    };
  }>(
    `mutation ProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(input: $input, identifier: $identifier, synchronous: true) {
        product { id handle status variants(first: 100) { nodes { id sku } } }
        userErrors { field message }
      }
    }`,
    { input, identifier: existingId ? { id: existingId } : undefined },
  );
  throwOnUserErrors("Shopify productSet", data.productSet.userErrors);
  const product = data.productSet.product;
  if (!product) throw new Error("Shopify productSet lieferte kein Produkt zurück.");
  return { id: product.id, handle: product.handle, status: product.status, variants: product.variants.nodes };
}

export async function shopifyEnsureCollection(handle: string, title: string): Promise<string> {
  const found = await shopifyGraphql<{ collections: { nodes: { id: string }[] } }>(
    `query($q: String!) { collections(first: 1, query: $q) { nodes { id } } }`,
    { q: `handle:${handle}` },
  );
  if (found.collections.nodes[0]) return found.collections.nodes[0].id;

  const created = await shopifyGraphql<{
    collectionCreate: { collection: { id: string } | null; userErrors: ShopifyUserError[] };
  }>(
    `mutation($input: CollectionInput!) {
      collectionCreate(input: $input) { collection { id } userErrors { field message } }
    }`,
    { input: { title, handle } },
  );
  throwOnUserErrors("Shopify collectionCreate", created.collectionCreate.userErrors);
  if (!created.collectionCreate.collection) throw new Error("Shopify collectionCreate lieferte keine Kollektion.");
  return created.collectionCreate.collection.id;
}

// Veröffentlicht Produkt/Kollektion in allen Vertriebskanälen (z.B. Online Store) - ohne das ist ein
// aktives Produkt zwar angelegt, aber für Kunden nicht sichtbar.
export async function shopifyPublishEverywhere(resourceId: string): Promise<void> {
  const pubs = await shopifyGraphql<{ publications: { nodes: { id: string }[] } }>(
    `{ publications(first: 20) { nodes { id } } }`,
  );
  if (pubs.publications.nodes.length === 0) return;
  const res = await shopifyGraphql<{ publishablePublish: { userErrors: ShopifyUserError[] } }>(
    `mutation($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
    { id: resourceId, input: pubs.publications.nodes.map((p) => ({ publicationId: p.id })) },
  );
  throwOnUserErrors("Shopify publishablePublish", res.publishablePublish.userErrors);
}

export async function shopifyDeleteProduct(id: string): Promise<void> {
  const res = await shopifyGraphql<{ productDelete: { userErrors: ShopifyUserError[] } }>(
    `mutation($input: ProductDeleteInput!) { productDelete(input: $input) { userErrors { field message } } }`,
    { input: { id } },
  );
  throwOnUserErrors("Shopify productDelete", res.productDelete.userErrors);
}
