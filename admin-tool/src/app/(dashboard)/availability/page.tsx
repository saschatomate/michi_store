import { Clock } from "lucide-react";
import { loadAvailabilityRules } from "@/lib/availability-rules";
import { AvailabilityRulesForm } from "@/components/AvailabilityRulesForm";
import { RING_SIZE_MAX, RING_SIZE_MIN, RING_SIZE_UP } from "@/lib/availability";

export default async function AvailabilityPage() {
  const rules = await loadAvailabilityRules();

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold text-zinc-900">Lieferzeiten</h1>
        <p className="mt-0.5 flex items-start gap-1.5 text-sm text-zinc-500">
          <Clock size={15} className="mt-0.5 shrink-0 text-zinc-400" />
          <span>
            Es gibt keinen Status „ausverkauft“: Bestand 0 heißt Anfertigung auf Bestellung mit der
            hinterlegten Lieferzeit. Nur ein manuell als „nicht mehr lieferbar“ markiertes Produkt wird
            nicht mehr verkauft. Änderungen gelten sofort für alle Produkte.
          </span>
        </p>
      </div>
      <AvailabilityRulesForm rules={rules} />
      <p className="text-xs text-zinc-500">
        Ringgrößen: aus der Basisgröße des Katalogs sind alle ganzen Größen von {RING_SIZE_MIN} bis
        Basisgröße +{RING_SIZE_UP} (höchstens {RING_SIZE_MAX}) herstellbar. Lagerware gibt es nur in der
        Basisgröße, alle anderen Größen sind Anfertigung.
      </p>
    </div>
  );
}
