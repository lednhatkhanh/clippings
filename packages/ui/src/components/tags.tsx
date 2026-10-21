"use client";

import { Plus, Tag as TagIcon, X, Check } from "lucide-react";
import { useState } from "react";
import {
  Tag as AriaTag,
  Button,
  ComboBox,
  Input,
  Label,
  Link,
  ListBox,
  ListBoxItem,
  Popover,
  TagGroup,
  TagList,
  Text,
  type Key,
} from "react-aria-components";

import { normalizeTagName, tagNameKey, type Tag, type TagColor } from "@clippings/shared";

import { cn } from "../cn.ts";

const DOTS: Record<Exclude<TagColor, "none">, string> = {
  red: "bg-tag-red-dot",
  orange: "bg-tag-orange-dot",
  amber: "bg-tag-amber-dot",
  green: "bg-tag-green-dot",
  teal: "bg-tag-teal-dot",
  blue: "bg-tag-blue-dot",
  violet: "bg-tag-violet-dot",
  pink: "bg-tag-pink-dot",
};

/** A chip in each tag's container color, with the text color that sits on it. */
const CHIP_COLORS: Record<TagColor, string> = {
  none: "bg-ground-sunk text-ink-muted",
  red: "bg-tag-red text-on-tag-red",
  orange: "bg-tag-orange text-on-tag-orange",
  amber: "bg-tag-amber text-on-tag-amber",
  green: "bg-tag-green text-on-tag-green",
  teal: "bg-tag-teal text-on-tag-teal",
  blue: "bg-tag-blue text-on-tag-blue",
  violet: "bg-tag-violet text-on-tag-violet",
  pink: "bg-tag-pink text-on-tag-pink",
};

/** Each tag color as a person reads it, for a color picker. */
export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  none: "No color",
  red: "Red",
  orange: "Orange",
  amber: "Amber",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
};

/**
 * The 8px color dot. Decoration only: the name always says which tag it is. `none` draws nothing,
 * unless `showNone` asks for its empty ring, as a list of tags or colors does.
 */
export function TagDot({ color, showNone = false }: { color: TagColor; showNone?: boolean }) {
  if (color === "none") {
    return showNone ? (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full border border-line-strong bg-paper"
      />
    ) : null;
  }
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOTS[color])} />;
}

// 24px tall at least (WCAG 2.5.8), and outlined, so forced colors still draw the chip's edge.
const CHIP =
  "state-layer inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-sm border border-transparent px-2 typescale-label-md forced-colors:border-solid";

/** A tag as a link, usually to the list filtered by it. */
function TagChip({ tag, href }: { tag: Pick<Tag, "name" | "color">; href: string }) {
  return (
    <Link href={href} className={cn(CHIP, CHIP_COLORS[tag.color])}>
      <TagDot color={tag.color} />
      <span className="truncate">{tag.name}</span>
    </Link>
  );
}

export interface TagChipsProps {
  tags: readonly Pick<Tag, "name" | "color">[];
  /** Where each chip leads. */
  href: (name: string) => string;
  "aria-label": string;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/** A clipping's tags as a row of chips; nothing when it has none. */
export function TagChips({ tags, href, className, ...props }: TagChipsProps) {
  if (tags.length === 0) return null;
  return (
    <ul {...props} className={cn("flex flex-wrap gap-1", className)}>
      {tags.map((tag) => (
        <li key={tag.name} className="flex max-w-full">
          <TagChip tag={tag} href={href(tag.name)} />
        </li>
      ))}
    </ul>
  );
}

/** The key of a tag's option: its name as uniqueness sees it. */
const keyOf = tagNameKey;
const CREATE_KEY = "\u0000create";

export interface TagPickerProps {
  label: string;
  /** Every tag the user has, offered as options. */
  tags: readonly Tag[];
  /** The chosen tags' names. */
  value: readonly string[];
  onChange: (names: string[]) => void;
  /** Makes each chosen tag a link, usually to the list filtered by it. */
  tagHref?: (name: string) => string;
  /** Submits the chosen names with a form, one field of this name each. */
  name?: string;
  maxLength?: number;
  /** Shown under the field and marks it invalid. */
  errorMessage?: string;
  /** Shows the chosen tags but takes no changes: no typing, no removing. */
  isDisabled?: boolean;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

/**
 * Chooses tags: a combo box that offers the user's tags as they type and can create a new one,
 * then the chosen ones as removable chips. A chip added after it opens pops in on the
 * pop spring; under reduced motion it only fades.
 */
export function TagPicker({
  label,
  tags,
  value,
  onChange,
  tagHref,
  name,
  maxLength,
  errorMessage,
  isDisabled = false,
  className,
}: TagPickerProps) {
  const [inputValue, setInputValue] = useState("");
  // The chips there at first stay still; only ones added later pop in.
  const [initial] = useState(() => new Set(value.map(keyOf)));
  const typed = normalizeTagName(inputValue);
  // The user's tags, and chosen names that aren't tags yet: they are created on save.
  const known = [
    ...tags,
    ...value
      .filter((tagName) => !tags.some((tag) => keyOf(tag.name) === keyOf(tagName)))
      .map((tagName) => ({ id: keyOf(tagName), name: tagName, color: "none" as const })),
  ];
  const exists = known.some((tag) => keyOf(tag.name) === keyOf(typed));
  const items = [
    ...(typed && !exists ? [{ id: CREATE_KEY, name: typed, color: "none" as const }] : []),
    ...known
      .filter((tag) => keyOf(tag.name).includes(keyOf(typed)))
      .map((tag) => ({ ...tag, id: keyOf(tag.name) })),
  ];
  const colorOf = (tagName: string) =>
    known.find((tag) => keyOf(tag.name) === keyOf(tagName))?.color ?? "none";

  function create(tagName: string) {
    const normalized = normalizeTagName(tagName);
    if (normalized && !value.some((chosen) => keyOf(chosen) === keyOf(normalized))) {
      onChange([...value, normalized]);
    }
    setInputValue("");
  }

  /** The chosen keys from the combo box, back as names: kept ones in order, new ones last. */
  function choose(keys: readonly Key[]) {
    if (keys.includes(CREATE_KEY)) return create(typed);
    const kept = value.filter((tagName) => keys.includes(keyOf(tagName)));
    const added = keys
      .filter((key) => !value.some((tagName) => keyOf(tagName) === key))
      .flatMap((key) => known.filter((tag) => keyOf(tag.name) === key).map((tag) => tag.name));
    onChange([...kept, ...added]);
    setInputValue("");
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ComboBox
        selectionMode="multiple"
        items={items}
        inputValue={inputValue}
        onInputChange={setInputValue}
        value={value.map(keyOf)}
        onChange={choose}
        allowsEmptyCollection
        menuTrigger="focus"
        isInvalid={errorMessage ? true : undefined}
        isDisabled={isDisabled}
        className="flex flex-col gap-1"
      >
        <Label className="typescale-label-md text-ink-muted">{label}</Label>
        <Input
          placeholder="Add a tag"
          maxLength={maxLength}
          onKeyDown={(event) => {
            // Enter on what was typed adds it, even before an option is highlighted.
            if (
              event.key === "Enter" &&
              typed &&
              !event.currentTarget.getAttribute("aria-activedescendant")
            ) {
              event.preventDefault();
              create(typed);
            }
          }}
          className="min-h-11 rounded-lg field-indicator px-3.5 py-2.5 typescale-body-lg text-ink outline-none placeholder:text-ink-faint data-disabled:opacity-40"
        />
        {errorMessage ? (
          <Text slot="errorMessage" className="typescale-body-sm text-danger">
            {errorMessage}
          </Text>
        ) : null}
        <Popover
          offset={4}
          className="max-h-72 w-(--trigger-width) menu-pop scroll-thin overflow-y-auto rounded-lg-increased glass-float p-1.5 text-ink"
        >
          <ListBox
            renderEmptyState={() => (
              <p className="px-3 py-3 typescale-body-md text-ink-muted">Type to create a tag</p>
            )}
            className="flex flex-col outline-none"
          >
            {(item: (typeof items)[number]) => (
              <ListBoxItem
                id={item.id}
                textValue={item.name}
                className="flex min-h-11 cursor-default items-center gap-2.5 rounded-md px-2.5 typescale-label-lg text-ink transition-colors outline-none data-focused:bg-line medium:min-h-9.5 forced-colors:data-focused:outline-solid"
              >
                {({ isSelected }) =>
                  item.id === CREATE_KEY ? (
                    <>
                      <Plus className="size-4.5 text-ink-muted" />
                      <span className="truncate">Create &ldquo;{item.name}&rdquo;</span>
                    </>
                  ) : (
                    <>
                      {isSelected ? (
                        <Check className="size-4.5 text-ink-muted" />
                      ) : (
                        <TagIcon className="size-4.5 text-ink-muted" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <TagDot color={item.color} />
                    </>
                  )
                }
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
      {value.length > 0 ? (
        <TagGroup
          aria-label={`${label}: chosen`}
          onRemove={
            isDisabled
              ? undefined
              : (keys) => onChange(value.filter((tagName) => !keys.has(keyOf(tagName))))
          }
        >
          <TagList className="flex flex-wrap gap-1">
            {value.map((tagName) => (
              <AriaTag
                key={keyOf(tagName)}
                id={keyOf(tagName)}
                textValue={tagName}
                href={tagHref?.(tagName)}
                className={cn(
                  CHIP,
                  CHIP_COLORS[colorOf(tagName)],
                  "cursor-default",
                  isDisabled ? null : "pe-0",
                  initial.has(keyOf(tagName)) ? null : "tag-pop",
                )}
              >
                <TagDot color={colorOf(tagName)} />
                <span className="truncate">{tagName}</span>
                {isDisabled ? null : (
                  <Button
                    slot="remove"
                    aria-label={`Remove ${tagName}`}
                    className="state-layer flex size-6 shrink-0 items-center justify-center rounded-sm"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </AriaTag>
            ))}
          </TagList>
        </TagGroup>
      ) : null}
      {name
        ? value.map((tagName) => <input key={tagName} type="hidden" name={name} value={tagName} />)
        : null}
    </div>
  );
}
