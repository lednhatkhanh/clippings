"use client";

import { useEffect, useState } from "react";

import { useOpenNewClipping } from "@/components/clippings/new-clipping-dialog.tsx";
import { useTags } from "@/components/clippings/use-tags.ts";
import { saveAppearance } from "@/components/settings/save-appearance.ts";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  APPEARANCE_VALUES,
  pickAppearance,
  type Appearance,
  type PaletteName,
} from "@clippings/shared";
import {
  applyAppearance,
  Command,
  CommandGroup,
  CommandMenu,
  Dialog,
  Modal,
  toasts,
  transitionAppearance,
} from "@clippings/ui";

const MODES: Record<Appearance["theme"], string> = {
  light: "Light mode",
  dark: "Dark mode",
  system: "System mode",
};

const PALETTES: Record<PaletteName, string> = {
  olive: "Olive palette",
  ochre: "Ochre palette",
  terracotta: "Terracotta palette",
  ink: "Ink palette",
};

/** The appearance on screen, read from `<html>`, where a missing attribute means `system`. */
function shownAppearance(): Appearance {
  const root = document.documentElement;
  const shown = Object.fromEntries(
    APPEARANCE_KEYS.map((key) => [key, root.getAttribute(`data-${key}`) ?? "system"]),
  );
  return { ...APPEARANCE_DEFAULTS, ...pickAppearance(shown) };
}

type Switchable = "theme" | "palette";

/**
 * Switches mode or palette on this device and saves it, as Settings does. A failed save puts the
 * old value back, unless something else has been picked since.
 */
function switchAppearance<K extends Switchable>(key: K, value: Appearance[K]) {
  const shown = shownAppearance();
  const previous = shown[key];
  if (previous === value) return;
  transitionAppearance(() => applyAppearance({ ...shown, [key]: value }));

  saveAppearance({ [key]: value }).catch(() => {
    const now = shownAppearance();
    if (now[key] === value)
      transitionAppearance(() => applyAppearance({ ...now, [key]: previous }));
    toasts.show({ message: "Couldn't save that setting. Try again." });
  });
}

/** ⌘K or Ctrl+K, without Shift or Alt, which other shortcuts use. */
const isPaletteShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "k" &&
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey;

/**
 * ⌘K (Ctrl+K) from anywhere in the app opens a palette of commands: New clipping, go to a tag,
 * and switch mode or palette. Esc, or the shortcut again, closes it.
 */
export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  // Read when the palette opens, so the current mode and palette are marked.
  const [appearance, setAppearance] = useState<Appearance>(APPEARANCE_DEFAULTS);
  const openNewClipping = useOpenNewClipping();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      setAppearance(shownAppearance());
      setIsOpen((open) => !open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = () => setIsOpen(false);

  return (
    <Modal isDismissable isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dialog aria-label="Commands">
        {isOpen ? (
          <PaletteCommands
            appearance={appearance}
            onNewClipping={() => {
              close();
              openNewClipping();
            }}
            onAppearance={(key, value) => {
              close();
              switchAppearance(key, value);
            }}
            onNavigate={close}
          />
        ) : null}
      </Dialog>
    </Modal>
  );
}

function PaletteCommands({
  appearance,
  onNewClipping,
  onAppearance,
  onNavigate,
}: {
  appearance: Appearance;
  onNewClipping: () => void;
  onAppearance: <K extends Switchable>(key: K, value: Appearance[K]) => void;
  onNavigate: () => void;
}) {
  // Only fetched once the palette is open.
  const { tags } = useTags();

  return (
    <CommandMenu aria-label="Search commands" placeholder="Type a command or a tag">
      <CommandGroup title="Clippings">
        <Command id="new-clipping" icon="add" onAction={onNewClipping}>
          New clipping
        </Command>
      </CommandGroup>
      {tags.length > 0 ? (
        <CommandGroup title="Go to tag">
          {tags.map((tag) => (
            <Command
              key={tag.id}
              id={`tag:${tag.id}`}
              icon="sell"
              href={hrefWithTag(loadBrowseParams(""), tag.name)}
              textValue={`${tag.name} tag`}
              onAction={onNavigate}
            >
              {tag.name}
            </Command>
          ))}
        </CommandGroup>
      ) : null}
      <CommandGroup title="Appearance">
        {APPEARANCE_VALUES.theme.map((theme) => (
          <Command
            key={theme}
            id={`theme:${theme}`}
            isCurrent={appearance.theme === theme}
            onAction={() => onAppearance("theme", theme)}
          >
            {MODES[theme]}
          </Command>
        ))}
        {APPEARANCE_VALUES.palette.map((palette) => (
          <Command
            key={palette}
            id={`palette:${palette}`}
            isCurrent={appearance.palette === palette}
            onAction={() => onAppearance("palette", palette)}
          >
            {PALETTES[palette]}
          </Command>
        ))}
      </CommandGroup>
    </CommandMenu>
  );
}
