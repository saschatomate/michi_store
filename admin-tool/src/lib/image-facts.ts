export type ImageSize = "1024x1536" | "1536x1024" | "1024x1024";

export type BodyPartMapping = {
  bodyPart: string;
  compositionHint: string;
  size: ImageSize;
  // Grobe Schätzung, wie viel echte Körperbreite (mm) bei dieser Nahaufnahme-Rahmung ungefähr im
  // Bild zu sehen ist (z.B. Kinn-bis-Schulter-Bereich bei Colliers). Dient NUR dazu, in
  // image-generation.ts einen "Schmuckstück darf höchstens X% der Bildbreite einnehmen"-Wert
  // auszurechnen - ein Flächenanteil ist für ein Bildmodell eine direktere, verlässlichere
  // Stellschraube als eine abstrakte mm-Angabe, die es erst gedanklich in Bildmaßstab übersetzen
  // müsste. Bewusst grob geschätzt und über die Kategorien hinweg konsistent gehalten - kein
  // exaktes Messwert, sondern ein Anhaltspunkt zum Nachjustieren, falls Größen weiterhin nicht
  // passen.
  estimatedFrameWidthMm: number;
};

// Kategorie-Verteilung im Katalog (Stand Import): Ring 3869, Ohrschmuck 2311, Colliers 1440,
// Armbänder 596, Anhänger 472, Armreifen 177, Manschettenknöpfe 3, Schließen 1.
const BODY_PART_BY_HAUPTKATEGORIE: Record<string, BodyPartMapping> = {
  Ring: {
    bodyPart: "eine Hand",
    compositionHint:
      "Nahaufnahme mit großzügigerem, elegantem Ausschnitt statt extrem eng zugeschnitten: Hand " +
      "nahe Schlüsselbein/Kinn, dabei deutlich sichtbares Kinn, Hals, Schulteransatz und ein Teil " +
      "der Kleidung mit im Bild - nicht nur die isolierte Hand vor leerem Hintergrund. Die Hand ist " +
      "offen und entspannt, die Finger sanft gestreckt und leicht voneinander gespreizt (NICHT zur " +
      "Faust geballt, NICHT ineinander verschränkt oder stark gekrümmt) - jeder Finger muss klar " +
      "einzeln erkennbar sein, ohne dass sich benachbarte Finger berühren oder überlappen. Der " +
      "Ringfinger, auf dem der Ring sitzt, ist deutlich von den Nachbarfingern abgesetzt sichtbar. " +
      "Ring scharf im Fokus, restliche Hand und Umgebung durch Schärfentiefe leicht weich",
    size: "1024x1536",
    estimatedFrameWidthMm: 220,
  },
  Ohrschmuck: {
    bodyPart: "ein Ohr",
    compositionHint:
      "Nahaufnahme mit großzügigerem, elegantem Ausschnitt statt extrem eng zugeschnitten: Ohr, " +
      "Kieferlinie/Wange, Hals und ein Teil der Schulter/Kleidung sichtbar, Kopf leicht seitlich " +
      "gedreht, Haare aus dem Gesicht/vom Ohr weggehalten (zurückgebunden oder hinters Ohr gelegt), " +
      "sodass der Ohrschmuck frei sichtbar ist, dabei aber weiterhin deutlich Haare im Bild (z.B. " +
      "am Hinterkopf/seitlich). Schmuckstück scharf im Fokus, Haare und Hintergrund weich unscharf",
    size: "1024x1536",
    estimatedFrameWidthMm: 170,
  },
  // "Dekolleté" bewusst auf "Schlüsselbein/oberer Halsansatz" präzisiert und eine explizite
  // Bedeckungs-Klausel ergänzt - die Kombination aus (nahezu) faceless Crop + Dekolleté-Betonung
  // wurde von OpenAIs Sicherheitssystem einmal als safety_violations=[sexual] abgelehnt.
  Colliers: {
    bodyPart: "Hals und Schlüsselbein",
    compositionHint:
      "Beauty-Nahaufnahme mit großzügigerem Ausschnitt, elegant statt extrem eng zugeschnitten: " +
      "unterer Gesichtsbereich sichtbar (z.B. Nase/Mund/Kinn/Wange, am oberen Bildrand angeschnitten " +
      "- kein vollständiges Beauty-Porträt nötig, aber auch nicht bewusst faceless/anonymisiert), " +
      "dazu deutlich sichtbare Haare an der Seite des Kopfes sowie Hals und Schlüsselbein. Kleidung " +
      "bedeckt die Brust vollständig und nicht freizügig - sichtbar ist ausschließlich Schlüsselbein " +
      "und oberer Halsansatz, kein tiefer Ausschnitt. Kamera nahezu frontal mit leichtem Winkel. " +
      "Kragen oder Ausschnitt der Kleidung am unteren Bildrand sichtbar und Teil der Komposition. " +
      "Schmuckstück auf der Haut liegend scharf im Fokus, alles andere leicht weich",
    size: "1024x1536",
    estimatedFrameWidthMm: 180,
  },
  Anhänger: {
    bodyPart: "Hals und Schlüsselbein",
    compositionHint:
      "Beauty-Nahaufnahme mit großzügigerem Ausschnitt, elegant statt extrem eng zugeschnitten: " +
      "unterer Gesichtsbereich sichtbar (z.B. Nase/Mund/Kinn/Wange, am oberen Bildrand angeschnitten " +
      "- kein vollständiges Beauty-Porträt nötig, aber auch nicht bewusst faceless/anonymisiert), " +
      "dazu deutlich sichtbare Haare an der Seite des Kopfes sowie Hals und Schlüsselbein. Kleidung " +
      "bedeckt die Brust vollständig und nicht freizügig - sichtbar ist ausschließlich Schlüsselbein " +
      "und oberer Halsansatz, kein tiefer Ausschnitt. Kamera nahezu frontal mit leichtem Winkel. " +
      "Kragen oder Ausschnitt der Kleidung am unteren Bildrand sichtbar und Teil der Komposition. " +
      "Anhänger an einer Kette auf der Haut liegend scharf im Fokus, alles andere leicht weich",
    size: "1024x1536",
    estimatedFrameWidthMm: 180,
  },
  Armbänder: {
    bodyPart: "ein Handgelenk",
    compositionHint:
      "Nahaufnahme mit großzügigerem, elegantem Ausschnitt statt extrem eng zugeschnitten: " +
      "Handgelenk, Unterarm und deutlich sichtbarer Schulter-/Kleidungsbereich mit im Bild, oft in " +
      "sanfter Interaktion mit der anderen Hand (z.B. Hände sanft übereinander oder ineinander " +
      "verschränkt nahe Schlüsselbein) oder Unterarm hängend mit entspannt positionierten Fingern, " +
      "Armband scharf im Fokus, " +
      "restlicher Arm, zweite Hand und Hintergrund durch Schärfentiefe weich. Achtung: Bei " +
      "Armbändern ist die Innen-/Außenseite im Referenzfoto oft nicht eindeutig erkennbar - behalte " +
      "die im Referenzbild sichtbare Anordnung der Elemente exakt bei, anstatt sie zu erraten oder " +
      "zu vertauschen",
    size: "1024x1536",
    estimatedFrameWidthMm: 170,
  },
  Armreifen: {
    bodyPart: "ein Handgelenk",
    compositionHint:
      "Nahaufnahme mit großzügigerem, elegantem Ausschnitt statt extrem eng zugeschnitten: " +
      "Handgelenk, Unterarm und deutlich sichtbarer Schulter-/Kleidungsbereich mit im Bild, oft in " +
      "sanfter Interaktion mit der anderen Hand (z.B. Hände sanft übereinander oder ineinander " +
      "verschränkt nahe Schlüsselbein) oder Unterarm hängend mit entspannt positionierten Fingern, " +
      "Armreif scharf im Fokus, " +
      "restlicher Arm, zweite Hand und Hintergrund durch Schärfentiefe weich. Achtung: Bei " +
      "Armreifen ist die Innen-/Außenseite im Referenzfoto oft nicht eindeutig erkennbar - behalte " +
      "die im Referenzbild sichtbare Anordnung der Elemente exakt bei, anstatt sie zu erraten oder " +
      "zu vertauschen",
    size: "1024x1536",
    estimatedFrameWidthMm: 170,
  },
  Manschettenknöpfe: {
    bodyPart: "eine Hemdmanschette am Handgelenk",
    compositionHint:
      "Extreme Nahaufnahme eines Handgelenks mit Hemdmanschette, Manschettenknopf geschlossen und " +
      "scharf im Fokus, schlichter Hemdärmel, Hintergrund durch Schärfentiefe weich",
    size: "1024x1536",
    estimatedFrameWidthMm: 90,
  },
};

export function bodyPartMapping(hauptkategorie: string | null): BodyPartMapping | null {
  if (!hauptkategorie) return null;
  return BODY_PART_BY_HAUPTKATEGORIE[hauptkategorie] ?? null;
}

// --- MARINELL Model DNA -----------------------------------------------------------------------
// Vier feste, wiederkehrende Kampagnen-Models (aus "02 MARINELL Model DNA.docx") ersetzen die
// frühere zufällige Hautton-/Handform-Diversität. Jedes Produkt bekommt genau eines davon fest
// zugewiesen (siehe assignModel/sourceProducts.assignedModelKey) - dasselbe Produkt zeigt bei jeder
// Neu-Generierung immer dasselbe Model. gpt-image-1.5 hat keinen Gesichts-/Charakter-Lock (kein
// Seed-Replay) - Konsistenz wird über zwei Hebel angenähert: (1) diese fest wiederverwendete,
// sehr detaillierte Beschreibung, (2) ein echtes Referenzfoto des Models als zweites Eingabebild
// in generateProductImageVariant (image-generation.ts) - absolute Pixel-Identität über
// Generierungen hinweg ist damit nicht garantierbar, nur bestmöglich angenähert.
export type ModelKey =
  | "sophia"
  | "claire"
  | "jen"
  | "amara"
  | "adrian"
  | "luca"
  | "kenji"
  | "malik";

// Geschlecht rein für die Filterung in der manuellen Modellauswahl (ModelPickerModal) - hat keinen
// Einfluss auf assignModel()/die automatische Kategorie-Zuordnung, die weiterhin nur innerhalb der
// weiblichen 4 läuft (Bestandslogik). Die männlichen 4 (aus "03 MARINELL Model DNA (Maennlich).docx")
// sind bewusste Gegenstücke mit denselben 4 Markenrollen (Vertrauen/Leichtigkeit/Präzision/Stärke),
// aber absichtlich leicht abweichenden Hauttönen statt 1:1 kopierter Werte - siehe die Doku.
export type ModelGender = "weiblich" | "männlich";

export type MarinellModel = {
  key: ModelKey;
  name: string;
  gender: ModelGender;
  referenceImageUrl: string;
  physicalDescription: string;
  // Kurzbeschreibung für die manuelle Modellauswahl in der UI (nicht Teil des Bild-Prompts).
  tagline: string;
};

const MODEL_REFERENCE_BASE =
  "https://juczmszqojkmvigxyjvv.supabase.co/storage/v1/object/public/product-images/model-references";

export const MARINELL_MODELS: Record<ModelKey, MarinellModel> = {
  sophia: {
    key: "sophia",
    name: "Sophia",
    gender: "weiblich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/sophia.jpg`,
    tagline:
      "Ruhiges Vertrauen und klassische Eleganz - mittelbraune Wellen, Haselnussaugen. Das Gesicht " +
      "für zeitloses Fine Jewellery (Ring, Anhänger, Collier).",
    physicalDescription:
      "Europäische Frau, 33 Jahre, 172cm, schlanke, sportliche Figur mit langen eleganten " +
      "Proportionen. Mittelbraune Haare mit seidigem Glanz, große weiche Wellen, Mittelscheitel, " +
      "Brustlänge, niemals streng frisiert. Haselnussfarbene, warme, leicht mandelförmige Augen mit " +
      "ruhigem Blick. Leicht gebräunte Haut mit goldenem Unterton, natürlicher Porenstruktur, " +
      "dezenten Sommersprossen - keine übertriebene Beauty-Retusche, keine makellose Plastikhaut. " +
      "Natürliche, roséfarbene, weiche Lippen. Ovales Gesicht mit hohen Wangenknochen, weicher " +
      "Kieferlinie, symmetrisch, aber nie künstlich perfekt. Ruhige, intelligente, warmherzige " +
      "Ausstrahlung.",
  },
  claire: {
    key: "claire",
    name: "Claire",
    gender: "weiblich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/claire.jpg`,
    tagline:
      "Mediterrane Leichtigkeit - honigblonde Beach Waves, helle Augen. Das Gesicht für " +
      "Everyday-Diamonds und Alltagsschmuck (Armband, Armreif).",
    physicalDescription:
      "Europäische Frau, 31 Jahre, 174cm. Honigblonde Haare mit natürlichen Beach Waves und " +
      "sommerlicher Bewegung. Hellblaue bis graublaue Augen. Golden gebräunte Haut mit sichtbaren " +
      "Sommersprossen und gesunder natürlicher Hautstruktur, keine künstliche Retusche. Leicht " +
      "markante Wangen, strahlendes Lächeln. Offene, lebensfrohe, stilvolle, charismatische " +
      "Ausstrahlung.",
  },
  jen: {
    key: "jen",
    name: "Jen",
    gender: "weiblich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/jen.jpg`,
    tagline:
      "Urbane Präzision - dunkler Bob mit Pony, ruhiger Blick. Das Gesicht für moderne " +
      "High Jewellery und Ohrschmuck.",
    physicalDescription:
      "Ostasiatische Frau, 32 Jahre, 170cm. Tiefschwarze Haare mit seidigem Glanz, Long Bob mit " +
      "Pony oder gerade lange Haare. Dunkelbraune, ruhige, präzise, intelligente Augen. Warmer " +
      "Goldton der Haut mit perfekter natürlicher Struktur, kein Photoshop-Look. Natürliche, " +
      "warm-nude Lippen. Feine Gesichtszüge, elegante Kieferlinie, hohe Wangenknochen, ruhige " +
      "Mimik. Intelligente, diskrete, ästhetische, selbstbewusste Ausstrahlung.",
  },
  amara: {
    key: "amara",
    name: "Amara",
    gender: "weiblich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/amara.jpg`,
    tagline:
      "Skulpturale Stärke - natürliche Locken, warmer Ebenholzton. Das Gesicht für " +
      "außergewöhnliche Einzelstücke und High-Carat-Diamanten.",
    physicalDescription:
      "Frau mit südafrikanischen Wurzeln, 38 Jahre, 178cm, sehr schlanke, lange elegante " +
      "athletische Silhouette mit weichen femininen Linien. Natürlich tiefschwarze, voluminöse, " +
      "definierte Locken (moderner Afro-Look oder weiche natürliche Locken), gesund, seidig " +
      "glänzend, niemals künstlich gestylt. Dunkelbraune, ruhige, intensive, sehr ausdrucksstarke " +
      "Augen. Tiefer, warmer Ebenholzton der Haut mit goldenen Untertönen, natürliche " +
      "Hautstruktur mit sichtbaren Poren, feiner Glow durch Licht, keine übermäßige Retusche oder " +
      "künstliche Weichzeichnung. Hohe Wangenknochen, klare Kieferlinie, volle Lippen, elegante " +
      "Nase, harmonische Proportionen - eine Schönheit mit Charakter statt Perfektion. " +
      "Selbstbewusste, gelassene, würdevolle, präsente Ausstrahlung, ohne dominant zu wirken.",
  },
  // --- männliche Gegenstücke (aus "03 MARINELL Model DNA (Maennlich).docx") ------------------
  // Gleiche 4 Markenrollen wie oben (Adrian~Sophia, Luca~Claire, Kenji~Jen, Malik~Amara), Hauttöne
  // bewusst nicht 1:1 von der jeweiligen Frau übernommen, sondern leicht variiert.
  adrian: {
    key: "adrian",
    name: "Adrian",
    gender: "männlich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/adrian.jpg`,
    tagline:
      "Ruhiges Vertrauen und klassische Eleganz - dunkelbraunes Haar, Haselnuss-/Grünaugen. Das " +
      "Gesicht für zeitloses Fine Jewellery (Ring, Anhänger, Collier).",
    physicalDescription:
      "Europäischer Mann, 35 Jahre, 186cm, schlanke, athletische Figur mit langen, aufrechten " +
      "Proportionen. Dunkelbraune Haare mit natürlichem Glanz, kurz bis mittellang, lässig " +
      "zurückgekämmt oder leicht in die Stirn fallend, niemals streng gestylt. Kurzer, gepflegter " +
      "Dreitagebart. Haselnuss- bis grüne, warme Augen mit ruhigem, klarem Blick. Helle bis " +
      "mittlere Haut mit kühlem, dezent rosé-olivem Unterton, natürlicher Porenstruktur - keine " +
      "übertriebene Beauty-Retusche, keine makellose Plastikhaut. Kantig-ovales Gesicht mit hohen " +
      "Wangenknochen, markantem weichem Kinn, gerader Nase, symmetrisch, aber nie künstlich " +
      "perfekt. Ruhige, vertrauenswürdige, warmherzige, intelligente Ausstrahlung.",
  },
  luca: {
    key: "luca",
    name: "Luca",
    gender: "männlich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/luca.jpg`,
    tagline:
      "Mediterrane Leichtigkeit - dunkelblondes Beach Hair, helle Augen. Das Gesicht für " +
      "Everyday-Diamonds und Alltagsschmuck (Armband, Armreif).",
    physicalDescription:
      "Europäisch-mediterraner Mann, 33 Jahre, 189cm, schlanke, drahtig-athletische Figur mit " +
      "breiten Schultern und lässiger Eleganz. Dunkelblonde bis hellbraune Haare mit natürlicher " +
      "Textur und leichter Sonnenbewegung (Beach Hair), kurz bis mittellang. Heller, kurzer " +
      "Bartschatten. Graublaue bis grüne Augen mit offenem, lebensfrohem Blick. " +
      "Golden-bronzefarbene, sonnengeküsste Haut mit vereinzelten feinen Sonnenspuren, gesunder " +
      "natürlicher Hautstruktur, keine künstliche Retusche. Markante Wangenknochen, breites, " +
      "strahlendes Lächeln, kantige, freundliche Kieferlinie. Offene, lebensfrohe, stilvolle, " +
      "charismatische Ausstrahlung.",
  },
  kenji: {
    key: "kenji",
    name: "Kenji",
    gender: "männlich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/kenji.jpg`,
    tagline:
      "Urbane Präzision - kurzer, strukturierter Schnitt, ruhiger Blick. Das Gesicht für moderne " +
      "High Jewellery und Ohrschmuck.",
    physicalDescription:
      "Ostasiatischer Mann, 34 Jahre, 183cm, schlanke, sehnige, aufrechte Statur mit ruhiger " +
      "Präsenz. Tiefschwarze Haare mit seidigem Glanz, kurz geschnitten, moderner strukturierter " +
      "Schnitt. Glattrasiert oder minimaler Konturbart. Dunkelbraune, ruhige, präzise, wache " +
      "Augen. Warmer, neutraler Hautton mit feiner natürlicher Struktur, kein Photoshop-Look. " +
      "Feine, klare Gesichtszüge, definierte Kieferlinie, hohe Wangenknochen, ruhige, " +
      "konzentrierte Mimik. Intelligente, diskrete, ästhetische, selbstbewusste Ausstrahlung.",
  },
  malik: {
    key: "malik",
    name: "Malik",
    gender: "männlich",
    referenceImageUrl: `${MODEL_REFERENCE_BASE}/malik.jpg`,
    tagline:
      "Skulpturale Stärke - kurzer Vollbart, warmer Mahagonyton. Das Gesicht für außergewöhnliche " +
      "Einzelstücke und High-Carat-Diamanten.",
    physicalDescription:
      "Mann mit ostafrikanischen Wurzeln, 41 Jahre, 191cm, sehr schlanke, hochgewachsene, " +
      "athletische Silhouette mit ruhiger, würdevoller Haltung. Natürlich tiefschwarze, kurze " +
      "Haare, sauber gefadet oder minimal gelockt, gesunder seidiger Glanz, niemals künstlich " +
      "gestylt. Kurzer, dichter, gepflegter Vollbart mit klaren Konturen. Dunkelbraune, ruhige, " +
      "intensive, sehr ausdrucksstarke Augen. Warmer Mahagoni-/Kastanienbraunton der Haut mit " +
      "goldenen Reflexen, natürliche Hautstruktur mit sichtbaren Poren, feiner Glow durch Licht, " +
      "keine übermäßige Retusche. Hohe Wangenknochen, klare markante Kieferlinie, volle Lippen, " +
      "gerade Nase, harmonische, kraftvolle Proportionen. Selbstbewusste, gelassene, würdevolle, " +
      "präsente Ausstrahlung, ohne dominant zu wirken.",
  },
};

type ModelAssignmentInput = {
  hauptkategorie: string | null;
  giaZertifikatNr: string | null;
  caratur: number | null;
};

// Deterministische Kategorie-Zuordnung nach der in der Model-DNA-Doku selbst beschriebenen
// Rollenverteilung (Sophia = klassisches Vertrauen/Fine Jewellery, Claire = Leichtigkeit/Everyday,
// Jen = Präzision/urbane Eleganz, Amara = außergewöhnliche Einzelstücke/High Jewellery). Wird nur
// beim allerersten Generieren eines Produkts aufgerufen - danach greift immer
// sourceProducts.assignedModelKey (siehe image-actions.ts), damit die Zuordnung stabil bleibt, auch
// wenn sich diese Regel später ändert.
export function assignModel(product: ModelAssignmentInput): ModelKey {
  if (product.giaZertifikatNr && product.caratur !== null && product.caratur >= 1.0) {
    return "amara";
  }
  switch (product.hauptkategorie) {
    case "Ohrschmuck":
      return "jen";
    case "Armbänder":
    case "Armreifen":
      return "claire";
    case "Ring":
    case "Anhänger":
    case "Colliers":
    default:
      return "sophia";
  }
}

export type PoseVariant = {
  key: string;
  label: string;
  promptDescriptor: string;
};

// Drei feste Posen (aus den in der Doku gelisteten "Lieblingsperspektiven", modellübergreifend
// anwendbar) - ersetzen die frühere Hautton-/Handform-Zufallsvariation. Alle 3 Varianten eines
// Produkts zeigen dasselbe zugewiesene Model, nur Blickwinkel/Pose unterscheiden sich.
export const POSE_VARIANTS: PoseVariant[] = [
  {
    key: "dreiviertelprofil",
    label: "Dreiviertelprofil",
    promptDescriptor:
      "Dreiviertelprofil, Kopf leicht gedreht, Hand elegant nahe Gesicht oder Schlüsselbein positioniert",
  },
  {
    key: "frontal",
    label: "Frontal",
    promptDescriptor: "frontale Nahaufnahme mit direktem, ruhigem Blick in die Kamera",
  },
  {
    key: "seitlich",
    label: "Seitlich",
    promptDescriptor:
      "Portrait mit Blick leicht nach unten oder zur Seite, Hand am Hals oder im Haar",
  },
];
