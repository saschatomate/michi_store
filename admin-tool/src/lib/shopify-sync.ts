// Bewusst ohne "server-only": wird auch aus Standalone-Skripten aufgerufen (Testläufe), wie
// shopify-client.ts/csv-import.ts. Die Berechtigungsprüfung liegt in shopify-actions.ts.
//
// Übertragung eines freigegebenen Produkts nach Shopify (GraphQL productSet). Grundregeln:
// - Idempotent: nach der ersten Übertragung steht die Shopify-GID in source_products.shopify_product_id,
//   jede weitere Übertragung aktualisiert dasselbe Produkt.
// - Verkauf bei Bestand 0 bleibt möglich (inventoryPolicy CONTINUE, Bestandsverfolgung an) - es gibt
//   keinen Status "ausverkauft", Lieferzeit steht als Text und Metafield am Produkt/jeder Variante.
// - Medien werden nur bei der ERSTEN Übertragung mitgeschickt: productSet würde bei jedem Update
//   dieselben Bilder erneut anlegen. Bildänderungen nach dem Erstupload sind ein eigener Schritt.
// - Bestandsmengen werden nicht gesetzt (Standard 0 bei Verfolgung) und bei Updates nie überschrieben,
//   damit durch Bestellungen entstandene Minusbestände (= offene Anfertigungen) erhalten bleiben.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, productCategories, productGeneratedImages, sourceProducts } from "@/db/schema";
import {
  shopifyEnsureCollection,
  shopifyProductSet,
  shopifyPublishEverywhere,
} from "@/lib/shopify-client";
import { availabilityParagraph, deriveAvailability, type ProductAvailability } from "@/lib/availability";
import { loadAvailabilityRules } from "@/lib/availability-rules";
import { STONE_ORIGIN_LABELS } from "@/lib/custom-product";

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

export type SyncOptions = { mode: ShopifyMode; isTest?: boolean };
export type SyncResult = { shopifyProductId: string; handle: string; status: ShopifyMode; created: boolean };

export function buildProductSetInput(args: {
  product: SourceProduct;
  availability: ProductAvailability;
  paragraph: string;
  imageUrls: string[];
  collectionIds: string[];
  categorySlugs: string[];
  options: SyncOptions;
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

export async function syncProductToShopify(productId: number, options: SyncOptions): Promise<SyncResult> {
  const product = await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.id, productId) });
  if (!product) throw new Error("Produkt nicht gefunden.");
  if (product.discontinued) throw new Error("Produkt ist als nicht mehr lieferbar markiert.");

  const rules = await loadAvailabilityRules();
  const availability = deriveAvailability(product, rules);
  if (!availability.sellable) throw new Error("Produkt ist nicht verkaufbar.");
  if (product.hauptkategorie === "Ring" && availability.variants.length === 0) {
    throw new Error("Für diesen Ring lassen sich keine Größenvarianten ableiten (Basisgröße fehlt).");
  }

  const imageUrls = await collectShopifyImageUrls(product);
  if (imageUrls.length === 0) throw new Error("Kein Bild vorhanden.");

  // Kollektionen sicherstellen (einmal in Shopify anlegen, ID in der Kategorie merken).
  const chain = await categoryChain(product.id);
  const collectionIds: string[] = [];
  for (const cat of chain) {
    let id = cat.shopifyCollectionId;
    if (!id) {
      id = await shopifyEnsureCollection(cat.slug, cat.name);
      await db.update(categories).set({ shopifyCollectionId: id }).where(eq(categories.id, cat.id));
    }
    collectionIds.push(id);
  }

  const paragraph = availabilityParagraph(availability, rules);
  const categorySlugs = chain.map((c) => c.slug);
  const build = (isCreate: boolean) =>
    buildProductSetInput({ product, availability, paragraph, imageUrls, collectionIds, categorySlugs, options, isCreate });

  let existingId = product.shopifyProductId;
  let input = build(!existingId);
  let result;
  try {
    result = await shopifyProductSet(input, existingId);
  } catch (err) {
    // Wurde das Produkt in Shopify von Hand gelöscht, existiert die gespeicherte ID nicht mehr -
    // dann neu anlegen (mit Bildern) statt dauerhaft im Fehlerstatus zu hängen.
    const message = err instanceof Error ? err.message : String(err);
    if (!existingId || !/identifier was not found/i.test(message)) throw err;
    existingId = null;
    input = build(true);
    result = await shopifyProductSet(input, null);
  }

  const finalStatus: ShopifyMode = input.status === "ACTIVE" ? "active" : "draft";
  if (finalStatus === "active") {
    await shopifyPublishEverywhere(result.id);
    for (const id of collectionIds) await shopifyPublishEverywhere(id);
  }

  await db
    .update(sourceProducts)
    .set({
      shopifyProductId: result.id,
      shopifyStatus: finalStatus,
      shopifySyncedAt: new Date(),
      shopifySyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(sourceProducts.id, product.id));

  return { shopifyProductId: result.id, handle: result.handle, status: finalStatus, created: !existingId };
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

