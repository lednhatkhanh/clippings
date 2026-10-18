// Schema, migrations and the Clippings service live here (server-only).
// The migration runner is not exported from here: it is a deploy-time tool (`pnpm --filter @clippings/db migrate`).
export { createDatabase, type Database } from "./database";
export { createPool } from "./pool";
export { account, session, user, verification } from "./schema";
export type {
  Clock,
  Embedder,
  FetchedPage,
  JobPublisher,
  PageFetcher,
  PageSummary,
  Summarizer,
} from "./clippings/ports";
export {
  createClippingsService,
  InvalidCursorError,
  InvalidUrlError,
  NoteTooLongError,
  systemClock,
  type ClippingsPage,
  type ClippingsService,
  type EnrichmentOutcome,
  type ListClippingsInput,
  type SaveClippingInput,
  type SaveClippingResult,
} from "./clippings/service";
