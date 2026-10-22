// Schema, migrations and the Clippings service live here (server-only).
// The migration runner is not exported from here: it is a deploy-time tool (`pnpm --filter @clippings/db migrate`).
export { createDatabase, type Database } from "./database.ts";
export { createPool } from "./pool.ts";
export {
  account,
  EMBEDDING_DIMENSIONS,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConnections,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  session,
  user,
  verification,
} from "./schema.ts";
export type {
  Clock,
  Embedder,
  EmbeddingPurpose,
  FetchedPage,
  JobPublisher,
  PageFetcher,
  PageSummary,
  Summarizer,
  SummarizerInput,
} from "./clippings/ports.ts";
export {
  createClippingsService,
  IMPORT_DAILY_BUDGET,
  IMPORT_SPREAD_SECONDS,
  InvalidCursorError,
  InvalidTagColorError,
  InvalidTagsError,
  InvalidUrlError,
  MAX_BULK_CLIPPINGS,
  NoteTooLongError,
  systemClock,
  TagNameTakenError,
  TitleTooLongError,
  TooManyClippingsError,
  type ClippingsExport,
  type ClippingsPage,
  type ClippingsService,
  type EnrichmentOutcome,
  type ExportedClipping,
  type ImportCounts,
  type ImportItem,
  type ImportOptions,
  type ListClippingsInput,
  type ListSavedClippingsInput,
  type SavedClippingsPage,
  type TagClippingsInput,
  type TagClippingsResult,
  type SaveClippingInput,
  type SaveClippingResult,
  type SearchClippingsInput,
  type SearchResults,
  type UpdateClippingInput,
} from "./clippings/service.ts";
export {
  createSettingsService,
  InvalidSettingsError,
  type SettingsService,
} from "./settings/service.ts";
export {
  createConnectionsService,
  type Connection,
  type ConnectionsService,
} from "./connections/service.ts";
