// Bewusst ohne "server-only": wird vom Editor (Client) für den Vorschlag und von Server-Code
// gemeinsam genutzt. Regeln stehen an den Kategorien selbst (categories.rule_*), nicht im Code - eine
// neue Kategorie mit Regel braucht keine Codeänderung.
import type { StoneOrigin } from "@/db/schema";

export type CategoryNode = {
  id: number;
  parentId: number | null;
  name: string;
  ruleStoneOrigin: StoneOrigin | null;
  // Kommagetrennte Schmuckart-Schlüssel (siehe PRODUCT_TYPES), z.B. "armband,armreif".
  ruleProductType: string | null;
};

export function parseProductTypeRule(rule: string | null): string[] {
  return (rule ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

// Schlägt Kategorien vor: eine Kategorie passt, wenn sie selbst mindestens eine Regel hat und alle
// Regeln entlang ihrer Elternkette (nächste Ebene gewinnt) auf das Produkt zutreffen.
export function suggestCategoryIds(
  nodes: CategoryNode[],
  facts: { stoneOrigin: StoneOrigin | ""; productType: string },
): number[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return nodes
    .filter((node) => {
      if (!node.ruleStoneOrigin && !node.ruleProductType) return false;

      let origin: StoneOrigin | null = null;
      let types: string[] | null = null;
      const seen = new Set<number>();
      for (let cur: CategoryNode | undefined = node; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
        seen.add(cur.id);
        if (origin === null && cur.ruleStoneOrigin) origin = cur.ruleStoneOrigin;
        if (types === null && cur.ruleProductType) types = parseProductTypeRule(cur.ruleProductType);
      }

      if (origin && origin !== facts.stoneOrigin) return false;
      if (types && !types.includes(facts.productType)) return false;
      return true;
    })
    .map((n) => n.id);
}
