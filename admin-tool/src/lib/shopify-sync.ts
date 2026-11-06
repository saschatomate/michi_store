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
// - Der Anfangsbestand kommt beim Erstanlegen aus der DG-Datei (bestand); bei Updates werden Mengen nie überschrieben,
//   damit durch Bestellungen entstandene Minusbestände (= offene Anfertigungen) erhalten bleiben.
import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { categories, productAuditLog, productCategories, productGeneratedImages, sourceProducts } from "@/db/schema";
import {
  shopifyEnsureCollection,
  shopifyPrimaryLocationId,
  shopifyProductSet,
  shopifyPublishEverywhere,
  shopifyReplaceMedia,
  shopifySetProductStatus,
  shopifySetStockBySku,
} from "@/lib/shopify-client";
import { availabilityParagraph, deriveAvailability, type ProductAvailability } from "@/lib/availability";
import { loadAvailabilityRules } from "@/lib/availability-rules";
import { STONE_ORIGIN_LABELS } from "@/lib/custom-product";
import { descriptionHtml, descriptionPlain, shopPrice, shopTitle } from "@/lib/shop-data";
import { diffSnapshots, type ShopifyAction, type ShopifyChanges, type ShopifySnapshot } from "@/lib/shopify-changes";

type SourceProduct = typeof sourceProducts.$inferSelect;

const VENDOR = "MARINELL";
const NS = "marinell";

export type ShopifyMode = "draft" | "active";


// Nur Bilder, die von Hand freigegeben wurden (KI-generierte und selbst hochgeladene in den 6 Bild-Slots,
// siehe GeneratedImagesSection), in Slot-Reihenfolge. Die Originalbilder aus der DG-Datei (und die
// Rohbilder eigener Produkte) gehen bewusst NIE automatisch nach Shopify. Ein eigenes "Hauptbild"-Flag
// für das Shop-Raster gibt es noch nicht - das erste freigegebene Bild ist das Hauptbild.
export async function collectShopifyImageUrls(product: SourceProduct): Promise<string[]> {
  const approved = await db
    .select({ url: productGeneratedImages.imageUrl })
    .from(productGeneratedImages)
    .where(and(eq(productGeneratedImages.sourceProductId, product.id), eq(productGeneratedImages.status, "approved")))
    .orderBy(asc(productGeneratedImages.variantIndex));
  return approved.map((a) => a.url).filter((u): u is string => Boolean(u));
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

// Intro-Text der Kategorie: der erste vorhandene in der Reihenfolge "zugewiesene Kategorie, dann ihre
// Eltern" - die spezifischste Kategorie gewinnt.
function introFromChain(chain: { introText: string | null }[]): string | null {
  return chain.find((c) => c.introText?.trim())?.introText?.trim() ?? null;
}

export async function categoryIntroFor(productId: number): Promise<string | null> {
  return introFromChain(await categoryChain(productId));
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
  intro: string | null;
  imageUrls: string[];
  collectionIds: string[];
  categorySlugs: string[];
  options: { mode: ShopifyMode; isTest?: boolean };
  isCreate: boolean;
  // Standort für den Anfangsbestand - nur beim Erstanlegen gesetzt (siehe quantities unten).
  locationId?: string | null;
}) {
  const { product, availability, paragraph, intro, imageUrls, collectionIds, categorySlugs, options, isCreate, locationId } = args;

  const sellingPrice = shopPrice(product);
  if (sellingPrice === null) {
    throw new Error(`${product.modellErweitert} hat keinen Verkaufspreis.`);
  }
  const baseTitle = shopTitle(product);
  const title = options.isTest ? `[TEST] ${baseTitle}` : baseTitle;
  // Beschreibung = Kategorie-Intro + Faktenliste (oder manuelle Überschreibung), dazu die Lieferzeit.
  const bodyHtml = [descriptionHtml(product, intro), paragraph ? `<p><strong>${paragraph}</strong></p>` : ""]
    .filter(Boolean)
    .join("\n");

  const isRing = availability.variants.length > 0;
  const price = sellingPrice.toFixed(2);

  const variantMeta = (mode: string, label: string): Metafield[] => [
    ...metafield("production_mode", "single_line_text_field", mode),
    ...metafield("lead_time_text", "single_line_text_field", label),
  ];

  // Anfangsbestand aus der DG-Datei (bestand): nur beim ERSTEN Anlegen. Danach führt Shopify den Bestand
  // selbst (Bestellungen buchen ab, Minusbestände = offene Anfertigungen) und wird nie überschrieben.
  // Bei Ringen liegt der einzelne Lagerring in seiner Basisgröße, alle anderen Größen starten bei 0.
  const stock = Math.max(0, Math.floor(product.bestand ?? 0));
  const quantities = (qty: number) =>
    isCreate && locationId && qty > 0 ? { inventoryQuantities: [{ locationId, name: "available", quantity: qty }] } : {};

  const variants = isRing
    ? availability.variants.map((v) => ({
        optionValues: [{ optionName: "Ringgröße", name: v.size }],
        price,
        inventoryPolicy: "CONTINUE",
        inventoryItem: { sku: `${product.modellErweitert}-${v.size}`, tracked: true, requiresShipping: true },
        metafields: variantMeta(v.mode, v.label),
        ...quantities(v.isBaseSize ? stock : 0),
      }))
    : [
        {
          optionValues: [{ optionName: "Title", name: "Default Title" }],
          price,
          barcode: product.eanCode || undefined,
          inventoryPolicy: "CONTINUE",
          inventoryItem: { sku: product.modellErweitert, tracked: true, requiresShipping: true },
          metafields: variantMeta(availability.mode, availability.label),
          ...quantities(stock),
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
    descriptionHtml: bodyHtml || undefined,
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
  prep: { availability: ProductAvailability; imageUrls: string[]; chain: { slug: string }[]; intro: string | null },
  input: ReturnType<typeof buildProductSetInput>,
  shopStatus: string,
): ShopifySnapshot {
  return {
    title: input.title,
    price: shopPrice(product) !== null ? shopPrice(product)!.toFixed(2) : "",
    leadTime: prep.availability.label,
    sizes: prep.availability.variants.map((v) => v.size),
    images: prep.imageUrls.length,
    tags: [...input.tags].sort(),
    body: descriptionPlain(product, prep.intro),
    shopStatus,
  };
}

// Alles, was für die Übertragung berechnet wird - ohne Netzwerkzugriff auf Shopify.
async function prepare(product: SourceProduct) {
  const rules = await loadAvailabilityRules();
  const availability = deriveAvailability(product, rules);
  const imageUrls = await collectShopifyImageUrls(product);
  const chain = await categoryChain(product.id);
  return { rules, availability, imageUrls, chain, intro: introFromChain(chain), paragraph: availabilityParagraph(availability, rules) };
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
    intro: prep.intro,
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
  if (!product.shopifyProductId || shopPrice(product) === null) return false;
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
  if (imageUrls.length === 0) throw new Error("Kein freigegebenes Bild - nur freigegebene Bilder gehen nach Shopify.");

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
  let locationId = existingId ? null : await shopifyPrimaryLocationId();
  const build = (isCreate: boolean) =>
    buildProductSetInput({
      product,
      availability,
      paragraph: prep.paragraph,
      intro: prep.intro,
      imageUrls,
      collectionIds,
      categorySlugs,
      options: { mode, isTest: options.isTest },
      isCreate,
      locationId,
    });

  // "keep" bei bestehendem Produkt: Status gar nicht erst mitschicken, damit ein in Shopify von Hand
  // live geschalteter Artikel nicht auf Entwurf zurückfällt.
  const keepLiveStatus = options.mode === "keep" && Boolean(existingId);
  const withoutStatus = <T extends { status?: string }>(i: T): T => (keepLiveStatus ? { ...i, status: undefined } : i);

  let currentId = existingId;
  let input = withoutStatus(build(!currentId));
  let result;
  try {
    result = await shopifyProductSet(input, currentId);
  } catch (err) {
    // Wurde das Produkt in Shopify von Hand gelöscht, existiert die gespeicherte ID nicht mehr -
    // dann neu anlegen (mit Bildern) statt dauerhaft im Fehlerstatus zu hängen.
    const message = err instanceof Error ? err.message : String(err);
    if (!currentId || !/identifier was not found/i.test(message)) throw err;
    currentId = null;
    locationId = await shopifyPrimaryLocationId();
    input = build(true);
    result = await shopifyProductSet(input, null);
  }

  // Bildliste hat sich geändert (oder ist unbekannt) -> bei bestehendem Produkt Medien ersetzen.
  const previousImages = product.shopifyImageUrls;
  const imagesChanged = !previousImages || JSON.stringify(previousImages) !== JSON.stringify(imageUrls);
  if (currentId && imagesChanged) {
    await shopifyReplaceMedia(result.id, imageUrls, product.genProductNameDe || product.kurzBezeichnungDe || product.modellErweitert);
  }

  // Bei "keep" wurde kein Status mitgeschickt - maßgeblich ist, was in Shopify tatsächlich steht.
  const finalStatus: ShopifyMode = (keepLiveStatus ? result.status : input.status) === "ACTIVE" ? "active" : "draft";
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
      shopifySyncedStock: Math.max(0, Math.floor(product.bestand ?? 0)),
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

// Nächtlicher Abgleich nach dem DG-Sync: überträgt NUR die Stückzahl. Preis, Texte, Bilder,
// Kategorien und der Shopify-Status (live/Entwurf) bleiben unangetastet - die pflegt man im Tool
// bzw. direkt in Shopify. Geschrieben wird nur, wenn sich der DG-Bestand seit der letzten
// Übertragung geändert hat; bei Ringen betrifft das die Basisgröße (dort liegt der Lagerring).
// Einzige Ausnahme: manuell als nicht mehr lieferbar markierte Produkte werden archiviert.
export async function resyncStockLevels(limit = 200): Promise<ResyncSummary> {
  const candidates = await db
    .select()
    .from(sourceProducts)
    .where(isNotNull(sourceProducts.shopifyProductId))
    .orderBy(asc(sourceProducts.shopifySyncedAt));
  const rules = await loadAvailabilityRules();

  const summary: ResyncSummary = { checked: 0, updated: 0, unchanged: 0, failed: 0, remaining: 0 };
  for (const product of candidates) {
    summary.checked++;
    const stock = Math.max(0, Math.floor(product.bestand ?? 0));
    try {
      if (product.discontinued) {
        if (product.shopifyStatus === "archived") { summary.unchanged++; continue; }
        if (summary.updated + summary.failed >= limit) { summary.remaining++; continue; }
        await syncProductToShopify(product.id, { mode: "keep", onlyIfChanged: true, actor: "cron" });
        summary.updated++;
        continue;
      }
      if (product.shopifySyncedStock === stock) { summary.unchanged++; continue; }
      if (product.shopifySyncedStock === null) {
        // Bisher kein Vergleichswert gespeichert: nur merken, nichts nach Shopify schreiben.
        await db.update(sourceProducts).set({ shopifySyncedStock: stock }).where(eq(sourceProducts.id, product.id));
        summary.unchanged++;
        continue;
      }
      if (summary.updated + summary.failed >= limit) { summary.remaining++; continue; }

      const availability = deriveAvailability(product, rules);
      const quantities = new Map<string, number>();
      if (availability.variants.length > 0) {
        const base = availability.variants.find((v) => v.isBaseSize);
        if (base) quantities.set(`${product.modellErweitert}-${base.size}`, stock);
      } else {
        quantities.set(product.modellErweitert, stock);
      }
      const written = await shopifySetStockBySku(product.shopifyProductId!, quantities);
      if (written === 0) throw new Error("Keine passende Variante in Shopify gefunden.");

      await db.update(sourceProducts).set({ shopifySyncedStock: stock }).where(eq(sourceProducts.id, product.id));
      await logShopify(product.id, "shopify_updated", "cron", {
        Bestand: { from: product.shopifySyncedStock === null ? null : String(product.shopifySyncedStock), to: String(stock) },
      });
      summary.updated++;
    } catch (err) {
      summary.failed++;
      console.error(`[shopify-stock] ${product.modellErweitert}:`, err instanceof Error ? err.message : err);
    }
  }
  return summary;
}

// Voraussetzungen für "Für den Shop freigeben" - gibt die Liste der Gründe zurück (leer = ok).
export async function shopReadinessProblems(product: SourceProduct): Promise<string[]> {
  const problems: string[] = [];
  if (product.discontinued) problems.push("Produkt ist als nicht mehr lieferbar markiert");
  if (shopPrice(product) === null) problems.push("Verkaufspreis fehlt");
  if ((await collectShopifyImageUrls(product)).length === 0) problems.push("Kein freigegebenes Bild (nur freigegebene Bilder gehen nach Shopify)");
  if (product.hauptkategorie === "Ring") {
    const availability = deriveAvailability(product, await loadAvailabilityRules());
    if (availability.variants.length === 0) problems.push("Ringgrößen lassen sich nicht ableiten");
  }
  return problems;
}

