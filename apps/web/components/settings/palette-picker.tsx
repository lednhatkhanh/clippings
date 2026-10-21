"use client";

import { Check } from "lucide-react";
import { Radio, RadioGroup } from "react-aria-components";

import { PALETTE_NAMES, type PaletteName } from "@clippings/shared";
import { cn } from "@clippings/ui";

// Each swatch is in its palette's own colors, which stay put whatever palette the page is in.
const PALETTES: Record<PaletteName, { label: string; hint: string; swatch: string }> = {
  olive: {
    label: "Olive",
    hint: "Quiet green",
    swatch: "bg-linear-to-b from-palette-olive-top to-palette-olive text-on-palette-olive",
  },
  ochre: {
    label: "Ochre",
    hint: "Warm, bright",
    swatch: "bg-linear-to-b from-palette-ochre-top to-palette-ochre text-on-palette-ochre",
  },
  terracotta: {
    label: "Terracotta",
    hint: "Earthy",
    swatch:
      "bg-linear-to-b from-palette-terracotta-top to-palette-terracotta text-on-palette-terracotta",
  },
  ink: {
    label: "Ink",
    hint: "Cool blue",
    swatch: "bg-linear-to-b from-palette-ink-top to-palette-ink text-on-palette-ink",
  },
};

/** The accent: four paper cards, each with a swatch in its own colors. */
export function PalettePicker({
  value,
  onChange,
}: {
  value: PaletteName;
  onChange: (palette: PaletteName) => void;
}) {
  return (
    <RadioGroup
      aria-label="Accent"
      value={value}
      onChange={(next) => onChange(next as PaletteName)}
    >
      <div className="grid grid-cols-2 gap-2.5 medium:grid-cols-4">
        {PALETTE_NAMES.map((palette) => (
          <Radio
            key={palette}
            value={palette}
            className="group relative flex lift cursor-default flex-col items-start gap-3 rounded-lg paper p-3.5 text-start"
          >
            {/* The selection: a 2px ring in the accent's ink, over the card's own edge. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-lg border-2 border-accent-ink opacity-0 transition-opacity group-data-selected:opacity-100"
            />
            <span
              aria-hidden="true"
              className={cn(
                "flex size-8 items-center justify-center rounded-full shadow-paper",
                PALETTES[palette].swatch,
              )}
            >
              <Check className="size-4 stroke-3 opacity-0 transition-opacity group-data-selected:opacity-100" />
            </span>
            <span className="flex flex-col">
              <span className="typescale-title-sm">{PALETTES[palette].label}</span>
              <span className="typescale-body-sm text-ink-faint">{PALETTES[palette].hint}</span>
            </span>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
