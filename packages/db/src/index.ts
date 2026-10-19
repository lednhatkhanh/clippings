// Schema, migrations and the Clippings service live here (server-only).
// The migration runner is not exported from here: it is a deploy-time tool (`pnpm --filter @clippings/db migrate`).
export { createDatabase, type Database } from "./database.ts";
export { createPool } from "./pool.ts";
export { account, EMBEDDING_DIMENSIONS, session, user, verification } from "./schema.ts";
export type {
  Clock,
  Embedder,
  EmbeddingPurpose,
  FetchedPage,
  JobPublisher,
  PageFetcher,
  PageSummary,
  Summarizer,
} from "./clippings/ports.ts";
export {
  createClippingsService,
  InvalidCursorError,
  InvalidTagColorError,
  InvalidTagsError,
  InvalidUrlError,
  NoteTooLongError,
  systemClock,
  TagNameTakenError,
  type ClippingsExport,
  type ClippingsPage,
  type ClippingsService,
  type EnrichmentOutcome,
  type ExportedClipping,
  type ListClippingsInput,
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
