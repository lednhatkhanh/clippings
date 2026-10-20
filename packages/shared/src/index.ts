// Shared by web and extension: DTO types, appearance settings, tag names, the URL normalizer, the
// share-sheet link reader and the extension API's schemas.
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
export { formatAbsoluteDate, formatIsoUtc } from "./dates.ts";
export {
  CLIPPINGS_EXTENSION_ID,
  EXTENSION_API_ERRORS,
  EXTENSION_API_PATH,
  extensionClippingSchema,
  extensionLookupRequestSchema,
  extensionLookupResponseSchema,
  extensionPaletteMessageSchema,
  extensionSaveRequestSchema,
  extensionSaveResponseSchema,
  extensionSettingsSchema,
  extensionTagSchema,
  extensionTagsResponseSchema,
  extensionUpdateRequestSchema,
  isSaveablePage,
  UNKNOWN_CLIENT,
  type ExtensionApiError,
  type ExtensionClipping,
  type ExtensionLookupRequest,
  type ExtensionLookupResponse,
  type ExtensionPaletteMessage,
  type ExtensionSaveRequest,
  type ExtensionSaveResponse,
  type ExtensionSettings,
  type ExtensionUpdateRequest,
  type ExtensionSignInError,
} from "./extension.ts";
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
