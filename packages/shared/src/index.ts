// Shared by web and extension: DTO types, appearance settings, tag names, the URL normalizer and
// the share-sheet link reader.
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
  isTagColor,
  TAG_COLORS,
  tagNameKey,
  type Tag,
  type TagColor,
  type TagSummary,
} from "./tag.ts";
export { extractSharedUrl, type SharedData, type SharedLink } from "./share.ts";
export { parseWebUrl, type WebUrl } from "./url.ts";
