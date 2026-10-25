"use client";

import {
  Copy,
  MessageCircleQuestion,
  Monitor,
  Moon,
  Palette,
  Pin,
  PinOff,
  Plus,
  Share2,
  Sun,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useCurrentClipping } from "@/components/clippings/current-clipping.ts";
import {
  copyLinkWithToast,
  shareLinkWithToast,
  useCanShare,
} from "@/components/clippings/link-actions.ts";
import { useTags } from "@/components/clippings/use-tags.ts";
import {
  shownAppearance,
  switchAppearance,
  type Switchable,
} from "@/components/settings/switch-appearance.ts";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { APPEARANCE_VALUES, type Appearance, type PaletteName } from "@clippings/shared";
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
  raspberry: "Raspberry palette",
  graphite: "Graphite palette",
};

/**
 * The palette's modal and its commands, in a chunk of their own that `CommandPalette` loads once
 * the page is idle or the palette is first opened.
 */
export function PaletteModal({
  isOpen,
  onOpenChange,
  onNewClipping,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Opens "New clipping"; the palette closes itself first. */
  onNewClipping: () => void;
}) {
  const close = () => onOpenChange(false);

  return (
    <Modal variant="palette" isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog aria-label="Commands" className="min-h-0">
        {isOpen ? (
          <PaletteCommands
            onNewClipping={() => {
              close();
              onNewClipping();
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
  onNewClipping,
  onAppearance,
  onNavigate,
}: {
  onNewClipping: () => void;
  onAppearance: <K extends Switchable>(key: K, value: Appearance[K]) => void;
  onNavigate: () => void;
}) {
  // Mounted fresh on every open, so the current mode and palette are marked and the tags are
  // fetched only once the palette is open.
  const [appearance] = useState(shownAppearance);
  const { tags } = useTags();
  // Set while a clipping's detail page is open.
  const clipping = useCurrentClipping();
  const canShare = useCanShare();

  return (
    <CommandMenu aria-label="Search commands" placeholder="Type a command or a tag">
      <CommandGroup title="Clippings">
        <Command id="new-clipping" icon={Plus} onAction={onNewClipping}>
          New clipping
        </Command>
        <Command id="ask" icon={MessageCircleQuestion} href="/ask" onAction={onNavigate}>
          Ask my clippings
        </Command>
      </CommandGroup>
      {clipping ? (
        <CommandGroup title="This clipping">
          <Command
            id="clipping:pin"
            icon={clipping.pinned ? PinOff : Pin}
            onAction={() => {
              onNavigate();
              clipping.togglePin();
            }}
          >
            {clipping.pinned ? "Unpin clipping" : "Pin clipping"}
          </Command>
          {canShare ? (
            <Command
              id="clipping:share"
              icon={Share2}
              onAction={() => {
                onNavigate();
                void shareLinkWithToast({ title: clipping.title, url: clipping.url });
              }}
            >
              Share clipping
            </Command>
          ) : null}
          <Command
            id="clipping:copy-link"
            icon={Copy}
            onAction={() => {
              onNavigate();
              void copyLinkWithToast(clipping.url);
            }}
          >
            Copy link to the page
          </Command>
        </CommandGroup>
      ) : null}
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
