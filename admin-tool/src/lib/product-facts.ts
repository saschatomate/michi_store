export type DiamondSlot = {
  slot: number;
  art: string;
  anzahl?: string;
  carat?: string;
  farbe?: string;
  reinheit?: string;
  schliff?: string;
};

export type ColoredStoneSlot = {
  slot: number;
  art: string;
  anzahl?: string;
  carat?: string;
  farbe?: string;
  schliff?: string;
};

export function diamondSlots(raw: Record<string, string>): DiamondSlot[] {
  const slots: DiamondSlot[] = [];
  for (let i = 1; i <= 8; i++) {
    const art = raw[`Diamant${i}_Art`]?.trim();
    if (!art) continue;
    slots.push({
      slot: i,
      art,
      anzahl: raw[`Diamant${i}_Anzahl`]?.trim(),
      carat: raw[`Diamant${i}_Carat`]?.trim(),
      farbe: raw[`Diamant${i}_Farbe`]?.trim(),
      reinheit: raw[`Diamant${i}_Reinheit`]?.trim(),
      schliff: raw[`Diamant${i}_Schliff`]?.trim(),
    });
  }
  return slots;
}

export function coloredStoneSlots(raw: Record<string, string>): ColoredStoneSlot[] {
  const slots: ColoredStoneSlot[] = [];
  for (let i = 1; i <= 8; i++) {
    const art = raw[`Farbstein${i}_Art`]?.trim();
    if (!art) continue;
    slots.push({
      slot: i,
      art,
      anzahl: raw[`Farbstein${i}_Anzahl`]?.trim(),
      carat: raw[`Farbstein${i}_Carat`]?.trim(),
      farbe: raw[`Farbstein${i}_Farbe`]?.trim(),
      schliff: raw[`Farbstein${i}_Schliff`]?.trim(),
    });
  }
  return slots;
}
