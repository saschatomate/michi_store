import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../src/db/client";
import { sourceProducts, productGeneratedImages } from "../src/db/schema";
import { testShopifyConnection, createShopifyProduct, shopifyAdminProductUrl } from "../src/lib/shopify-client";
import { buildShopifyProductInput, defaultProductImageUrls } from "../src/lib/shopify-mapping";

// Einmaliger Verbindungs-/Upload-Test (siehe Gespräch mit dem Nutzer 2026-09-20): legt GENAU EIN
// Produkt als "draft" in Shopify an (Titel mit "[TEST] "-Präfix, Tag "claude-test"), schreibt aber
// nichts in unsere DB zurück (kein shopifyProductId, kein Statuswechsel) - reiner Konnektivitätstest,
// die echte Pipeline-Upload-Logik (wann/was aus Status "in_pipeline" hochgeladen wird) kommt später.
// Aufruf: npx tsx --env-file=.env.local scripts/tmp-shopify-test-upload.ts [Modell_Erweitert]

async function main() {
  console.log("1/3 Prüfe Shopify-Verbindung...");
  const shop = await testShopifyConnection();
  console.log(`    OK - verbunden mit "${shop.name}" (${shop.domain})`);

  const requestedSku = process.argv[2];
  const product = requestedSku
    ? await db.query.sourceProducts.findFirst({ where: eq(sourceProducts.modellErweitert, requestedSku) })
    : await db.query.sourceProducts.findFirst({
        where: and(isNotNull(sourceProducts.uvp), isNotNull(sourceProducts.genProductNameDe)),
      });

  if (!product) {
    throw new Error(
      requestedSku
        ? `Produkt "${requestedSku}" nicht gefunden.`
        : "Kein Produkt mit UVP + generiertem Text gefunden - bitte Modell_Erweitert explizit angeben.",
    );
  }
  console.log(`2/3 Baue Payload für ${product.modellErweitert} ("${product.kurzBezeichnungDe ?? ""}")...`);

  const approvedImages = await db.query.productGeneratedImages.findMany({
    where: and(eq(productGeneratedImages.sourceProductId, product.id), eq(productGeneratedImages.status, "approved")),
  });
  const imageUrls = [
    ...defaultProductImageUrls(product),
    ...approvedImages.map((img) => img.imageUrl).filter((u): u is string => Boolean(u)),
  ];

  const payload = buildShopifyProductInput(product, imageUrls, { isTest: true });
  console.log(`    ${imageUrls.length} Bild(er), Preis ${payload.variants?.[0]?.price}, Status "${payload.status}"`);

  console.log("3/3 Lege Testprodukt in Shopify an...");
  const created = await createShopifyProduct(payload);
  console.log(`    Erstellt: ${created.title} (ID ${created.id}, Status ${created.status})`);
  console.log(`    Admin-Link: ${shopifyAdminProductUrl(created.id)}`);
  console.log("\nHinweis: als Draft angelegt (nicht im Storefront sichtbar). Zum Löschen des Tests im");
  console.log("Shopify-Admin öffnen und entfernen, oder deleteShopifyProduct(id) aus shopify-client.ts nutzen.");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
