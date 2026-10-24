import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceProducts, productGeneratedImages, STATUS_VALUES } from "@/db/schema";
import { buildWhere } from "@/lib/product-query";
import { shopPrice } from "@/lib/shop-data";

// Nur lesender MCP-Server (stdio) für das Admin-Tool: Produkte per natürlicher Sprache suchen.
// Läuft lokal, nutzt DATABASE_URL aus .env.local und schreibt nie in die Datenbank.
// Wichtig: auf stdout darf nichts außer dem MCP-Protokoll landen (kein console.log).

const server = new McpServer({ name: "marinell-products", version: "1.0.0" });

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function summarize(p: typeof sourceProducts.$inferSelect) {
  return {
    id: p.id,
    sku: p.modellErweitert,
    name: p.genProductNameDe ?? p.kurzBezeichnungDe,
    kategorie: [p.kategorieEbene1, p.kategorieEbene2, p.kategorieEbene3].filter(Boolean).join(" > ") || null,
    material: p.hauptmaterial,
    legierung: p.legierung,
    caratGesamt: p.caratur,
    preisUvp: p.uvp,
    shopPreis: shopPrice(p),
    waehrung: p.uvpWaehrung,
    bestand: p.bestand,
    status: p.status,
    herkunft: p.origin === "custom" ? "eigenes Produkt" : "Diamond Group",
    nichtMehrBeiDiamondGroup: p.missingFromStockAt !== null,
    ausgelistet: p.discontinued,
    anShopify: p.shopifyProductId ? (p.shopifyStatus ?? "übertragen") : null,
  };
}

const MAX_LIMIT = 50;

server.registerTool(
  "search_products",
  {
    description:
      "Sucht Produkte im MARINELL-Katalog. Alle Filter sind optional und werden kombiniert (UND). " +
      "Freitext q durchsucht Name, Beschreibung, SKU und EAN. Preise in der Währung des Eintrags (meist EUR, UVP). " +
      "Kategorien/Materialien vorher ggf. mit list_filter_values nachschlagen.",
    inputSchema: {
      q: z.string().optional().describe("Freitext (Name, SKU, EAN)"),
      kategorie1: z.string().optional().describe("Kategorie Ebene 1, z.B. Ring, Ohrschmuck, Collier"),
      kategorie2: z.string().optional(),
      kategorie3: z.string().optional(),
      material: z.array(z.string()).optional().describe("Hauptmaterial, z.B. Gelbgold"),
      legierung: z.array(z.string()).optional(),
      preisMin: z.number().optional(),
      preisMax: z.number().optional(),
      caratMin: z.number().optional(),
      caratMax: z.number().optional(),
      nurMitBestand: z.boolean().optional().describe("Nur Produkte mit Bestand >= 1"),
      status: z.enum(STATUS_VALUES).optional().describe("Pipeline-Status"),
      nurNeuErschienen: z.boolean().optional(),
      nurNichtMehrBeiDiamondGroup: z.boolean().optional().describe("Nur Produkte, die nicht mehr in der DG-Datei stehen"),
      nurEigeneProdukte: z.boolean().optional(),
      nurAnShopifyUebertragen: z.boolean().optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Standard 20, max ${MAX_LIMIT}`),
      offset: z.number().int().min(0).optional(),
    },
  },
  async (a) => {
    const where = buildWhere({
      q: a.q?.trim() || undefined,
      kategorie1: a.kategorie1,
      kategorie2: a.kategorie2,
      kategorie3: a.kategorie3,
      material: a.material,
      legierung: a.legierung,
      priceMin: a.preisMin,
      priceMax: a.preisMax,
      caratMin: a.caratMin,
      caratMax: a.caratMax,
      bestandMin: a.nurMitBestand ? 1 : undefined,
      status: a.status,
      newArrivalOnly: a.nurNeuErschienen,
      missingOnly: a.nurNichtMehrBeiDiamondGroup,
      customOnly: a.nurEigeneProdukte,
      shopifyOnly: a.nurAnShopifyUebertragen,
    } as Parameters<typeof buildWhere>[0]);
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(sourceProducts)
        .where(where)
        .orderBy(desc(sourceProducts.updatedAt))
        .limit(a.limit ?? 20)
        .offset(a.offset ?? 0),
      db.select({ total: sql<number>`count(*)::int` }).from(sourceProducts).where(where),
    ]);
    return text({ gesamtTreffer: total, angezeigt: rows.length, produkte: rows.map(summarize) });
  },
);

server.registerTool(
  "get_product",
  {
    description:
      "Alle Details zu einem Produkt (per SKU 'Modell_Erweitert' oder interner id): Maße, Steine, Preise, " +
      "Texte, Shopify-Stand und Bilder (KI-generiert und eigene).",
    inputSchema: {
      sku: z.string().optional().describe("Modell_Erweitert, z.B. 1A421W856"),
      id: z.number().int().optional(),
    },
  },
  async ({ sku, id }) => {
    if (!sku && id === undefined) return text("Bitte sku oder id angeben.");
    const p = await db.query.sourceProducts.findFirst({
      where: sku ? eq(sourceProducts.modellErweitert, sku.trim()) : eq(sourceProducts.id, id!),
    });
    if (!p) return text("Produkt nicht gefunden.");
    const images = await db
      .select({
        slot: productGeneratedImages.variantIndex,
        label: productGeneratedImages.handPreset,
        status: productGeneratedImages.status,
        eigenesBild: productGeneratedImages.isUpload,
        url: productGeneratedImages.imageUrl,
      })
      .from(productGeneratedImages)
      .where(eq(productGeneratedImages.sourceProductId, p.id))
      .orderBy(productGeneratedImages.variantIndex);
    return text({
      ...summarize(p),
      ean: p.eanCode,
      beschreibung: p.genLongDescDe ?? p.langBezeichnungDe,
      masse: { hoehe: p.hoehe, breite: p.breite, durchmesser: p.durchmesser, staerke: p.staerke, ringgroesse: p.ringgroesse },
      diamant: {
        carat: p.caratur,
        anzahl: p.anzahlSteine,
        farbe: p.diamantFarbe,
        reinheit: p.diamantReinheit,
        schliff: p.diamantSchliffguete,
      },
      einkaufspreis: p.einkaufspreis,
      shopify: { id: p.shopifyProductId, status: p.shopifyStatus, zuletztUebertragen: p.shopifySyncedAt },
      nichtMehrBeiDiamondGroupSeit: p.missingFromStockAt,
      originalBilder: [p.freistellerUrl, p.modelbildUrl, ...(p.bildUrls ?? [])].filter(Boolean),
      bilderSlots: images,
    });
  },
);

server.registerTool(
  "list_filter_values",
  {
    description: "Zeigt, welche Kategorien (Ebene 1), Materialien und Legierungen im Katalog vorkommen, mit Anzahl.",
    inputSchema: {},
  },
  async () => {
    const count = sql<number>`count(*)::int`;
    const [kat, mat, leg] = await Promise.all([
      db.select({ wert: sourceProducts.kategorieEbene1, anzahl: count }).from(sourceProducts).where(isNotNull(sourceProducts.kategorieEbene1)).groupBy(sourceProducts.kategorieEbene1).orderBy(desc(count)),
      db.select({ wert: sourceProducts.hauptmaterial, anzahl: count }).from(sourceProducts).where(isNotNull(sourceProducts.hauptmaterial)).groupBy(sourceProducts.hauptmaterial).orderBy(desc(count)),
      db.select({ wert: sourceProducts.legierung, anzahl: count }).from(sourceProducts).where(isNotNull(sourceProducts.legierung)).groupBy(sourceProducts.legierung).orderBy(desc(count)),
    ]);
    return text({ kategorieEbene1: kat, hauptmaterial: mat, legierung: leg });
  },
);

server.registerTool(
  "catalog_stats",
  { description: "Kennzahlen zum Katalog: Gesamtzahl, nach Status, an Shopify übertragen, nicht mehr bei Diamond Group, eigene Produkte.", inputSchema: {} },
  async () => {
    const [[totals], byStatus] = await Promise.all([
      db
        .select({
          gesamt: sql<number>`count(*)::int`,
          anShopify: sql<number>`count(${sourceProducts.shopifyProductId})::int`,
          nichtMehrBeiDiamondGroup: sql<number>`count(${sourceProducts.missingFromStockAt})::int`,
          eigene: sql<number>`count(*) filter (where ${sourceProducts.origin} = 'custom')::int`,
          ausgelistet: sql<number>`count(*) filter (where ${sourceProducts.discontinued})::int`,
        })
        .from(sourceProducts),
      db.select({ status: sourceProducts.status, anzahl: sql<number>`count(*)::int` }).from(sourceProducts).groupBy(sourceProducts.status),
    ]);
    return text({ ...totals, nachStatus: byStatus });
  },
);

server.connect(new StdioServerTransport()).catch((err) => {
  console.error(err);
  process.exit(1);
});
