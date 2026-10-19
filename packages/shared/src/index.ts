// Shared by web and extension: DTO types, appearance settings, tag names and the URL normalizer.
export {
  APPEARANCE_DEFAULTS,
  APPEARANCE_KEYS,
  APPEARANCE_VALUES,
  DEFAULT_PALETTE,
  isAppearanceValue,
  PALETTE_NAMES,
  pickAppearance,
  type Appearance,
  type AppearanceKey,
  type PaletteName,
} from "./appearance.ts";
export {
  CLIPPING_SOURCES,
  CLIPPING_STATUSES,
  MAX_NOTE_LENGTH,
  type Clipping,
  type ClippingSource,
  type ClippingStatus,
} from "./clipping.ts";
export { formatIsoUtc } from "./dates.ts";
export {
  MAX_QUERY_LENGTH,
  SEARCH_RESULT_LIMIT,
  SEARCH_SORTS,
  type SearchHighlights,
  type SearchHit,
  type SearchSort,
  type TextSegment,
} from "./search.ts";
export {
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CLIPPING,
  normalizeTagName,
  normalizeTagNames,
  TAG_COLORS,
  tagNameKey,
  type Tag,
  type TagColor,
} from "./tag.ts";
export { parseWebUrl, type WebUrl } from "./url.ts";
