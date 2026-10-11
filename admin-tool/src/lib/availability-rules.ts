import { db } from "@/db/client";
import { availabilityRules } from "@/db/schema";
import { DEFAULT_RULES, type AvailabilityRule, type AvailabilityRules } from "@/lib/availability";

export async function loadAvailabilityRules(): Promise<AvailabilityRules> {
  const rows = await db.select().from(availabilityRules);
  const rules: AvailabilityRules = { ...DEFAULT_RULES };
  for (const r of rows) {
    if (r.key in rules) {
      rules[r.key as keyof AvailabilityRules] = { unit: r.unit as AvailabilityRule["unit"], min: r.minValue, max: r.maxValue };
    }
  }
  return rules;
}
