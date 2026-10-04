import type { sourceProducts } from "@/db/schema";
import type { ShopifyProductInput } from "@/lib/shopify-client";

type SourceProduct = typeof sourceProducts.$inferSelect;

const VENDOR = "MARINELL";

// Gleiche Reihenfolge wie in der Produkt-Detailseite (freisteller -> modelbild -> weitere CSV-Bilder).
// KI-generierte Produktbilder (productGeneratedImages, nur approved) kommen nicht aus der DB-Tabelle
// selbst und werden vom Aufrufer bei Bedarf zusätzlich angehängt.
export function defaultProductImageUrls(product: SourceProduct): string[] {
  return [product.freistellerUrl, product.modelbildUrl, ...(product.bildUrls ?? [])].filter(
    (u): u is string => Boolean(u),
  );
}

function htmlFromPlainText(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${para.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export type BuildShopifyProductOptions = {
  status?: "draft" | "active" | "archived";
  // Markiert Titel/Tags eindeutig als Testartikel und erzwingt status "draft", egal was übergeben
  // wurde - für den Verbindungstest, nicht für echte Pipeline-Uploads.
  isTest?: boolean;
};

export function buildShopifyProductInput(
  product: SourceProduct,
  imageUrls: string[],
  options: BuildShopifyProductOptions = {},
): ShopifyProductInput {
  if (product.uvp === null || product.uvp === undefined) {
    throw new Error(
      `${product.modellErweitert} hat keinen UVP - kann ohne Preis nicht zu Shopify hochgeladen werden.`,
    );
  }

  const title = product.genProductNameDe || product.kurzBezeichnungDe || product.modellErweitert;
  const bodyText = product.genLongDescDe || product.langBezeichnungDe || "";

  const tags = [
    product.hauptkategorie,
    product.kategorieEbene1,
    product.kategorieEbene2,
    product.kategorieEbene3,
    product.hauptmaterial,
    product.legierung,
    options.isTest ? "claude-test" : null,
  ].filter((t): t is string => Boolean(t));

  return {
    title: options.isTest ? `[TEST] ${title}` : title,
    body_html: bodyText ? htmlFromPlainText(bodyText) : undefined,
    vendor: VENDOR,
    product_type: product.kategorieEbene1 || product.hauptkategorie || undefined,
    tags: tags.length > 0 ? tags.join(", ") : undefined,
    status: options.isTest ? "draft" : options.status || "draft",
    images: imageUrls.length > 0 ? imageUrls.map((src) => ({ src })) : undefined,
    variants: [
      {
        price: product.uvp.toFixed(2),
        sku: product.modellErweitert,
        barcode: product.eanCode || undefined,
        inventory_management: "shopify",
        inventory_policy: "deny",
        inventory_quantity: product.bestand ?? 0,
      },
    ],
  };
}
