"use client";

import { Monitor, Moon, Palette, Plus, Sun, Tag, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useOpenNewClipping } from "@/components/clippings/new-clipping-dialog.tsx";
import { useTags } from "@/components/clippings/use-tags.ts";
import {
  shownAppearance,
  switchAppearance,
  type Switchable,
} from "@/components/settings/switch-appearance.ts";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_VALUES,
  type Appearance,
  type PaletteName,
} from "@clippings/shared";
import { Command, CommandGroup, CommandMenu, Dialog, Modal } from "@clippings/ui";

const MODES: Record<Appearance["theme"], string> = {
  light: "Light mode",
  dark: "Dark mode",
  system: "System mode",
};

const MODE_ICONS: Record<Appearance["theme"], LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const PALETTES: Record<PaletteName, string> = {
  olive: "Olive palette",
  ochre: "Ochre palette",
  terracotta: "Terracotta palette",
  ink: "Ink palette",
};

/** ⌘K or Ctrl+K, without Shift or Alt, which other shortcuts use. */
const isPaletteShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "k" &&
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey;

/** Fired on `document` to open the palette from a button, such as the rail's "Jump to…". */
const OPEN_EVENT = "clippings:open-command-palette";

/** Opens the command palette, as ⌘K does. Does nothing until a `CommandPalette` is mounted. */
export function openCommandPalette() {
  document.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/**
 * ⌘K (Ctrl+K) from anywhere in the app opens a palette of commands: New clipping, go to a tag,
 * and switch mode or palette. Esc, or the shortcut again, closes it. `openCommandPalette()` opens
 * it from a button.
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
    const onOpen = () => {
      setAppearance(shownAppearance());
      setIsOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const close = () => setIsOpen(false);

  return (
    <Modal variant="palette" isDismissable isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dialog aria-label="Commands" className="min-h-0">
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
        <Command id="new-clipping" icon={Plus} onAction={onNewClipping}>
          New clipping
        </Command>
      </CommandGroup>
      {tags.length > 0 ? (
        <CommandGroup title="Go to tag">
          {tags.map((tag) => (
            <Command
              key={tag.id}
              id={`tag:${tag.id}`}
              icon={Tag}
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
            icon={MODE_ICONS[theme]}
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
            icon={Palette}
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
