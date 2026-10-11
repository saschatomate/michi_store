// Bewusst ohne "server-only": wird auch aus Standalone-Skripten aufgerufen (Testläufe), wie
// shopify-client.ts/csv-import.ts. Die Berechtigungsprüfung liegt in shopify-actions.ts.
//
// Übertragung eines freigegebenen Produkts nach Shopify (GraphQL productSet). Grundregeln:
// - Idempotent: nach der ersten Übertragung steht die Shopify-GID in source_products.shopify_product_id,
//   jede weitere Übertragung aktualisiert dasselbe Produkt.
// - Verkauf bei Bestand 0 bleibt möglich (inventoryPolicy CONTINUE, Bestandsverfolgung an) - es gibt
//   keinen Status "ausverkauft", Lieferzeit steht als Text und Metafield am Produkt/jeder Variante.
// - Medien gehen beim Erstanlegen mit; danach werden sie nur ersetzt, wenn sich die Bildliste
//   geändert hat (shopifyReplaceMedia), weil productSet sie sonst bei jedem Update doppelt anlegt.
// - Nachziehen: nach jeder Übertragung wird eine Prüfsumme gespeichert. Weicht die aktuelle
//   Berechnung davon ab (Preis, Text, Lieferzeit, Kategorien, Bilder ...), ist Shopify nicht mehr
//   aktuell - resyncChangedProducts() (nächtlicher Cron) und der Knopf am Produkt ziehen es nach.
// - Bestandsmengen werden nicht gesetzt (Standard 0 bei Verfolgung) und bei Updates nie überschrieben,
//   damit durch Bestellungen entstandene Minusbestände (= offene Anfertigungen) erhalten bleiben.
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, productAuditLog, productCategories, productGeneratedImages, sourceProducts } from "@/db/schema";
import {
  shopifyEnsureCollection,
  shopifyProductSet,
  shopifyPublishEverywhere,
  shopifyReplaceMedia,
  shopifySetProductStatus,
} from "@/lib/shopify-client";
import { availabilityParagraph, deriveAvailability, type ProductAvailability } from "@/lib/availability";
import { loadAvailabilityRules } from "@/lib/availability-rules";
import { STONE_ORIGIN_LABELS } from "@/lib/custom-product";
import { diffSnapshots, type ShopifyAction, type ShopifyChanges, type ShopifySnapshot } from "@/lib/shopify-changes";

type SourceProduct = typeof sourceProducts.$inferSelect;

const VENDOR = "MARINELL";
const NS = "marinell";

export type ShopifyMode = "draft" | "active";

function htmlFromPlainText(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${para.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// Reihenfolge: Originalbilder (bei eigenen Produkten die selbst hochgeladenen), danach freigegebene
// KI-Bilder. Ein eigenes "Hauptbild"-Flag für das Shop-Raster gibt es noch nicht.
export async function collectShopifyImageUrls(product: SourceProduct): Promise<string[]> {
  const originals =
    product.origin === "custom"
      ? (product.customImages ?? []).map((i) => i.url)
      : [product.freistellerUrl, product.modelbildUrl, ...(product.bildUrls ?? [])];
  const approved = await db
    .select({ url: productGeneratedImages.imageUrl })
    .from(productGeneratedImages)
    .where(and(eq(productGeneratedImages.sourceProductId, product.id), eq(productGeneratedImages.status, "approved")))
    .orderBy(asc(productGeneratedImages.variantIndex));
  return [...originals, ...approved.map((a) => a.url)].filter((u): u is string => Boolean(u));
}

type Metafield = { namespace: string; key: string; type: string; value: string };

function metafield(key: string, type: string, value: string | number | boolean | null | undefined): Metafield[] {
  if (value === null || value === undefined || value === "") return [];
  return [{ namespace: NS, key, type, value: String(value) }];
}

// Eigene Kategorie + alle Eltern (ein Produkt in "Lab Diamonds › Ringe" erscheint auch in "Lab Diamonds").
async function categoryChain(productId: number) {
  const all = await db.select().from(categories).orderBy(asc(categories.sortOrder));
  const byId = new Map(all.map((c) => [c.id, c]));
  const assigned = await db
    .select({ id: productCategories.categoryId })
    .from(productCategories)
    .where(eq(productCategories.sourceProductId, productId));
  const chain = new Map<number, (typeof all)[number]>();
  for (const { id } of assigned) {
    for (let cur = byId.get(id); cur && !chain.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      chain.set(cur.id, cur);
    }
  }
  return Array.from(chain.values());
}

export type SyncOptions = {
  // "keep": den bisherigen Shopify-Status beibehalten (live bleibt live, Entwurf bleibt Entwurf) -
  // für automatische Nachführung. Archivierte Produkte kommen dabei als Entwurf zurück.
  mode: ShopifyMode | "keep";
  isTest?: boolean;
  // Nur übertragen, wenn sich seit der letzten Übertragung etwas geändert hat.
  onlyIfChanged?: boolean;
  // Wer die Übertragung ausgelöst hat - steht im Shopify-Verlauf ("admin" | "cron").
  actor?: "admin" | "cron";
};
export type SyncResult = {
  shopifyProductId: string;
  handle: string | null;
  status: ShopifyMode | "archived";
  created: boolean;
  skipped?: boolean;
};

function resolveMode(product: SourceProduct, options: SyncOptions): ShopifyMode {
  if (options.mode !== "keep") return options.mode;
  return product.shopifyStatus === "active" ? "active" : "draft";
}

export function buildProductSetInput(args: {
  product: SourceProduct;
  availability: ProductAvailability;
  paragraph: string;
  imageUrls: string[];
  collectionIds: string[];
  categorySlugs: string[];
  options: { mode: ShopifyMode; isTest?: boolean };
  isCreate: boolean;
}) {
  const { product, availability, paragraph, imageUrls, collectionIds, categorySlugs, options, isCreate } = args;

  if (product.uvp === null || product.uvp === undefined) {
    throw new Error(`${product.modellErweitert} hat keinen Verkaufspreis.`);
  }
  const baseTitle = product.genProductNameDe || product.kurzBezeichnungDe || product.modellErweitert;
  const title = options.isTest ? `[TEST] ${baseTitle}` : baseTitle;
  const bodyText = product.genLongDescDe || product.langBezeichnungDe || "";
  const descriptionHtml = [bodyText ? htmlFromPlainText(bodyText) : "", paragraph ? `<p><strong>${paragraph}</strong></p>` : ""]
    .filter(Boolean)
    .join("\n");

  const isRing = availability.variants.length > 0;
  const price = product.uvp.toFixed(2);

  const variantMeta = (mode: string, label: string): Metafield[] => [
    ...metafield("production_mode", "single_line_text_field", mode),
    ...metafield("lead_time_text", "single_line_text_field", label),
  ];

  const variants = isRing
    ? availability.variants.map((v) => ({
        optionValues: [{ optionName: "Ringgröße", name: v.size }],
        price,
        inventoryPolicy: "CONTINUE",
        inventoryItem: { sku: `${product.modellErweitert}-${v.size}`, tracked: true, requiresShipping: true },
        metafields: variantMeta(v.mode, v.label),
      }))
    : [
        {
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          price,
          barcode: product.eanCode || undefined,
          inventoryPolicy: "CONTINUE",
          inventoryItem: { sku: product.modellErweitert, tracked: true, requiresShipping: true },
          metafields: variantMeta(availability.mode, availability.label),
        },
      ];

  const tags = [
    ...categorySlugs.map((s) => `kat:${s}`),
    product.hauptmaterial,
    product.legierung,
    product.stoneOrigin ? (product.stoneOrigin === "lab_grown" ? "labordiamant" : "naturdiamant") : null,
    availability.mode === "made_to_order" ? "made-to-order" : null,
    options.isTest ? "claude-test" : null,
  ].filter((t): t is string => Boolean(t));

  const metafields: Metafield[] = [
    ...metafield("sku", "single_line_text_field", product.modellErweitert),
    ...metafield("source", "single_line_text_field", product.origin),
    ...metafield("production_mode", "single_line_text_field", availability.mode),
    ...metafield("lead_time_text", "single_line_text_field", availability.label),
    ...metafield("stone_origin", "single_line_text_field", product.stoneOrigin ? STONE_ORIGIN_LABELS[product.stoneOrigin] : null),
    ...metafield("fineness", "number_integer", product.fineness),
    ...metafield("rhodiniert", "boolean", product.rhodiniert),
    ...metafield("cut_shape", "single_line_text_field", product.cutShape),
    ...metafield("cut_quality", "single_line_text_field", product.diamantSchliffguete),
    ...metafield("main_stone_ct", "number_decimal", product.mainStoneCt),
    ...metafield("total_ct", "number_decimal", product.caratur),
    ...metafield("diamond_color", "single_line_text_field", product.diamantFarbe),
    ...metafield("clarity", "single_line_text_field", product.diamantReinheit),
    ...metafield("cert_institute", "single_line_text_field", product.certInstitute),
    ...metafield("cert_number", "single_line_text_field", product.certNumber),
    ...metafield("design_family_id", "single_line_text_field", product.designFamilyId),
  ];

  return {
    title,
    descriptionHtml: descriptionHtml || undefined,
    vendor: VENDOR,
    productType: product.kategorieEbene1 || product.hauptkategorie || undefined,
    tags,
    status: options.mode === "active" && !options.isTest ? "ACTIVE" : "DRAFT",
    seo:
      product.genSeoTitle || product.genSeoDescription
        ? { title: product.genSeoTitle || undefined, description: product.genSeoDescription || undefined }
        : undefined,
    productOptions: isRing
      ? [{ name: "Ringgröße", values: availability.variants.map((v) => ({ name: v.size })) }]
      : [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants,
    metafields,
    collections: collectionIds,
    files: isCreate
      ? imageUrls.map((url) => ({ originalSource: url, contentType: "IMAGE", alt: baseTitle }))
      : undefined,
  };
}

async function logShopify(productId: number, action: ShopifyAction, actor: string, changes: ShopifyChanges | null) {
  await db.insert(productAuditLog).values({ sourceProductId: productId, action, actor, changes });
}

function snapshotOf(
  product: SourceProduct,
  prep: { availability: ProductAvailability; imageUrls: string[]; chain: { slug: string }[] },
  input: ReturnType<typeof buildProductSetInput>,
  shopStatus: string,
): ShopifySnapshot {
  const bodyText = (product.genLongDescDe || product.langBezeichnungDe || "").trim();
  return {
    title: input.title,
    price: product.uvp !== null ? product.uvp.toFixed(2) : "",
    leadTime: prep.availability.label,
    sizes: prep.availability.variants.map((v) => v.size),
    images: prep.imageUrls.length,
    tags: [...input.tags].sort(),
    body: bodyText,
    shopStatus,
  };
}

// Alles, was für die Übertragung berechnet wird - ohne Netzwerkzugriff auf Shopify.
async function prepare(product: SourceProduct) {
  const rules = await loadAvailabilityRules();
  const availability = deriveAvailability(product, rules);
  const imageUrls = await collectShopifyImageUrls(product);
  const chain = await categoryChain(product.id);
  return { rules, availability, imageUrls, chain, paragraph: availabilityParagraph(availability, rules) };
}

function signatureOf(
  product: SourceProduct,
  prep: Awaited<ReturnType<typeof prepare>>,
): string {
  // Kollektions-IDs gehören nicht dazu (Slugs stecken in den Tags), Medien nur über die URL-Liste.
  const input = buildProductSetInput({
    product,
    availability: prep.availability,
    paragraph: prep.paragraph,
    imageUrls: [],
    collectionIds: [],
    categorySlugs: prep.chain.map((c) => c.slug),
    options: { mode: "draft" },
    isCreate: false,
  });
  return createHash("sha1")
    .update(JSON.stringify({ input: { ...input, status: undefined }, images: prep.imageUrls, discontinued: product.discontinued }))
    .digest("hex");
}

// True, wenn das Produkt schon in Shopify liegt und sich seitdem etwas geändert hat.
export async function isShopifyOutOfSync(product: SourceProduct): Promise<boolean> {
  if (!product.shopifyProductId || product.uvp === null) return false;
  if (product.shopifySyncSignature === null) return true;
  return signatureOf(product, await prepare(product)) !== product.shopifySyncSignature;
}

export async function syncProductToShopify(productId: number, options: SyncOptions): Promise<SyncResult> {
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, productId) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  const existingId = product.shopifyProductId;

  // Ausgelistet: nicht mehr verkaufen. Liegt das Produkt schon in Shopify, wird es archiviert
  // (statt gelöscht - Bestellungen und Verlauf bleiben erhalten).
  if (product.discontinued) {
    if (!existingId) throw new Error("Produkt ist als nicht mehr lieferbar markiert.");
    if (product.shopifyStatus === "archived" && options.onlyIfChanged) {
      return { shopifyProductId: existingId, handle: null, status: "archived", created: false, skipped: true };
    }
    if (product.shopifyStatus !== "archived") await shopifySetProductStatus(existingId, "ARCHIVED");
    await db
      .update(sourceProducts)
      .set({ shopifyStatus: "archived", shopifySyncedAt: new Date(), shopifySyncError: null, shopifySyncSignature: null })
      .where(eq(sourceProducts.id, product.id));
    await logShopify(product.id, "shopify_archived", options.actor ?? "admin", {
      "Shopify-Status": { from: product.shopifyStatus === "active" ? "live" : "Entwurf", to: "archiviert (ausgelistet)" },
    });
    return { shopifyProductId: existingId, handle: null, status: "archived", created: false };
  }

  const prep = await prepare(product);
  const { availability, imageUrls, chain } = prep;
  if (!availability.sellable) throw new Error("Produkt ist nicht verkaufbar.");
  if (product.hauptkategorie === "Ring" && availability.variants.length === 0) {
    throw new Error("Für diesen Ring lassen sich keine Größenvarianten ableiten (Basisgröße fehlt).");
  }
  if (imageUrls.length === 0) throw new Error("Kein Bild vorhanden.");

  const signature = signatureOf(product, prep);
  if (options.onlyIfChanged && existingId && product.shopifyStatus !== "archived" && signature === product.shopifySyncSignature) {
    return { shopifyProductId: existingId, handle: null, status: product.shopifyStatus === "active" ? "active" : "draft", created: false, skipped: true };
  }

  const mode = resolveMode(product, options);

  // Kollektionen sicherstellen (einmal in Shopify anlegen, ID in der Kategorie merken).
  const collectionIds: string[] = [];
  for (const cat of chain) {
    let id = cat.shopifyCollectionId;
    if (!id) {
      id = await shopifyEnsureCollection(cat.slug, cat.name);
      await db.update(categories).set({ shopifyCollectionId: id }).where(eq(categories.id, cat.id));
    }
    collectionIds.push(id);
  }

  const categorySlugs = chain.map((c) => c.slug);
  const build = (isCreate: boolean) =>
    buildProductSetInput({
      product,
      availability,
      paragraph: prep.paragraph,
      imageUrls,
      collectionIds,
      categorySlugs,
      options: { mode, isTest: options.isTest },
      isCreate,
    });

  let currentId = existingId;
  let input = build(!currentId);
  let result;
  try {
    result = await shopifyProductSet(input, currentId);
  } catch (err) {
    // Wurde das Produkt in Shopify von Hand gelöscht, existiert die gespeicherte ID nicht mehr -
    // dann neu anlegen (mit Bildern) statt dauerhaft im Fehlerstatus zu hängen.
    const message = err instanceof Error ? err.message : String(err);
    if (!currentId || !/identifier was not found/i.test(message)) throw err;
    currentId = null;
    input = build(true);
    result = await shopifyProductSet(input, null);
  }

  // Bildliste hat sich geändert (oder ist unbekannt) -> bei bestehendem Produkt Medien ersetzen.
  const previousImages = product.shopifyImageUrls;
  const imagesChanged = !previousImages || JSON.stringify(previousImages) !== JSON.stringify(imageUrls);
  if (currentId && imagesChanged) {
    await shopifyReplaceMedia(result.id, imageUrls, product.genProductNameDe || product.kurzBezeichnungDe || product.modellErweitert);
  }

  const finalStatus: ShopifyMode = input.status === "ACTIVE" ? "active" : "draft";
  if (finalStatus === "active") {
    await shopifyPublishEverywhere(result.id);
    for (const id of collectionIds) await shopifyPublishEverywhere(id);
  }

  const snapshot = snapshotOf(product, prep, input, finalStatus);
  const previous = (product.shopifySnapshot as ShopifySnapshot | null) ?? null;

  await db
    .update(sourceProducts)
    .set({
      shopifyProductId: result.id,
      shopifyStatus: finalStatus,
      shopifySyncedAt: new Date(),
      shopifySyncError: null,
      shopifySyncSignature: signature,
      shopifyImageUrls: imageUrls,
      shopifySnapshot: snapshot,
      updatedAt: new Date(),
    })
    .where(eq(sourceProducts.id, product.id));

  const created = !currentId;
  const changes = created
    ? { "Preis": { from: null, to: snapshot.price }, "Shopify-Status": { from: null, to: finalStatus === "active" ? "live" : "Entwurf" } }
    : diffSnapshots(previous, snapshot);
  await logShopify(
    product.id,
    created ? "shopify_created" : "shopify_updated",
    options.actor ?? "admin",
    Object.keys(changes).length > 0
      ? changes
      : { Hinweis: { from: null, to: previous ? "Abgleich ohne sichtbare Feldänderung" : "Erster Abgleich mit Verlauf" } },
  );

  return { shopifyProductId: result.id, handle: result.handle, status: finalStatus, created: !currentId };
}

export type PublishResult =
  | { ok: true; shopifyProductId: string; status: SyncResult["status"]; created: boolean; skipped: boolean }
  | { ok: false; error: string };

async function logStatus(id: number, from: string, to: string) {
  await db.insert(productAuditLog).values({ sourceProductId: id, action: "status", changes: { status: { from, to } } });
}

// Übertragen + Ergebnis am Produkt festhalten: Erfolg -> "Veröffentlicht", Fehler -> "Übertragungsfehler"
// mit Fehlertext. Wird vom Knopf am Produkt und vom nächtlichen Nachlauf gleichermaßen benutzt.
export async function publishAndRecord(id: number, options: SyncOptions): Promise<PublishResult> {
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, id) });
  if (!product) return { ok: false, error: "Produkt nicht gefunden." };
  try {
    const result = await syncProductToShopify(id, options);
    if (product.status !== "veroeffentlicht") {
      await db.update(sourceProducts).set({ status: "veroeffentlicht" }).where(eq(sourceProducts.id, id));
      await logStatus(id, product.status, "veroeffentlicht");
    }
    return { ok: true, shopifyProductId: result.shopifyProductId, status: result.status, created: result.created, skipped: result.skipped ?? false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(sourceProducts)
      .set({ status: "uebertragungsfehler", shopifySyncError: message.slice(0, 2000), updatedAt: new Date() })
      .where(eq(sourceProducts.id, id));
    if (product.status !== "uebertragungsfehler") await logStatus(id, product.status, "uebertragungsfehler");
    await logShopify(id, "shopify_error", options.actor ?? "admin", { Fehler: { from: null, to: message.slice(0, 500) } });
    return { ok: false, error: message };
  }
}

export type ResyncSummary = { checked: number; updated: number; unchanged: number; failed: number; remaining: number };

// Nächtlicher Nachlauf: alle Produkte, die schon in Shopify liegen, werden geprüft und bei
// Abweichung (Preis, Text, Lieferzeit/Lagerstatus, Kategorien, Bilder, ausgelistet) aktualisiert.
// Pro Lauf höchstens `limit` Übertragungen, der Rest folgt beim nächsten Lauf (die Prüfsumme bleibt
// ja abweichend). Fehlgeschlagene Produkte werden jede Nacht erneut versucht.
export async function resyncChangedProducts(limit = 25): Promise<ResyncSummary> {
  const candidates = await db
    .select()
    .from(sourceProducts)
    .where(
      and(
        isNotNull(sourceProducts.shopifyProductId),
        or(inArray(sourceProducts.status, ["veroeffentlicht", "uebertragungsfehler"]), eq(sourceProducts.discontinued, true)),
      ),
    )
    .orderBy(asc(sourceProducts.shopifySyncedAt));

  const summary: ResyncSummary = { checked: 0, updated: 0, unchanged: 0, failed: 0, remaining: 0 };
  for (const product of candidates) {
    summary.checked++;
    if (summary.updated + summary.failed >= limit) {
      // Nur noch zählen, was sich geändert hat - ohne zu übertragen.
      if (await isShopifyOutOfSync(product).catch(() => true)) summary.remaining++;
      continue;
    }
    const res = await publishAndRecord(product.id, { mode: "keep", onlyIfChanged: true, actor: "cron" });
    if (!res.ok) summary.failed++;
    else if (res.skipped) summary.unchanged++;
    else summary.updated++;
  }
  return summary;
}

// Voraussetzungen für "Für den Shop freigeben" - gibt die Liste der Gründe zurück (leer = ok).
export async function shopReadinessProblems(product: SourceProduct): Promise<string[]> {
  const problems: string[] = [];
  if (product.discontinued) problems.push("Produkt ist als nicht mehr lieferbar markiert");
  if (!product.contentApprovedAt) problems.push("Texte sind noch nicht freigegeben");
  if (product.uvp === null || product.uvp === undefined) problems.push("Verkaufspreis fehlt");
  if ((await collectShopifyImageUrls(product)).length === 0) problems.push("Kein Bild vorhanden");
  if (product.hauptkategorie === "Ring") {
    const availability = deriveAvailability(product, await loadAvailabilityRules());
    if (availability.variants.length === 0) problems.push("Ringgrößen lassen sich nicht ableiten");
  }
  return problems;
}

