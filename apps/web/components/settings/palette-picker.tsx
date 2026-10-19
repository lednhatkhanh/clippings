"use client";

import { Label, Radio, RadioGroup } from "react-aria-components";

import { PALETTE_NAMES, type PaletteName } from "@clippings/shared";
import { cn, Icon } from "@clippings/ui";

// Each swatch is in its palette's own colors, which stay put whatever palette the page is in.
const PALETTES: Record<PaletteName, { label: string; ring: string; dot: string }> = {
  olive: { label: "Olive", ring: "bg-palette-olive-container", dot: "bg-palette-olive" },
  ochre: { label: "Ochre", ring: "bg-palette-ochre-container", dot: "bg-palette-ochre" },
  terracotta: {
    label: "Terracotta",
    ring: "bg-palette-terracotta-container",
    dot: "bg-palette-terracotta",
  },
  ink: { label: "Ink", ring: "bg-palette-ink-container", dot: "bg-palette-ink" },
};

/** One of the four palettes, each shown in its own colors. */
export function PalettePicker({
  value,
  onChange,
}: {
  value: PaletteName;
  onChange: (palette: PaletteName) => void;
}) {
  return (
    <RadioGroup
      value={value}
      onChange={(next) => onChange(next as PaletteName)}
      className="flex flex-col gap-3"
    >
      <Label className="typescale-title-md">Palette</Label>
      <div className="grid grid-cols-2 gap-3 medium:grid-cols-4">
        {PALETTE_NAMES.map((palette) => (
          <Radio
            key={palette}
            value={palette}
            className="state-layer flex cursor-default items-center gap-3 rounded-md border border-outline-variant p-3 transition-colors data-selected:border-primary data-selected:bg-secondary-container data-selected:text-on-secondary-container"
          >
            {({ isSelected }) => (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    PALETTES[palette].ring,
                  )}
                >
                  <span className={cn("size-4 rounded-full", PALETTES[palette].dot)} />
                </span>
                <span className="flex-1 typescale-label-lg">{PALETTES[palette].label}</span>
                {isSelected ? (
                  <span className="flex check-pop">
                    <Icon name="check" />
                  </span>
                ) : null}
              </>
            )}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}
