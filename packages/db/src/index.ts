// Schema, migrations and the Clippings service live here (server-only).
// The migration runner is not exported from here: it is a deploy-time tool (`pnpm --filter @clippings/db migrate`).
export { createDatabase, type Database } from "./database";
export { createPool } from "./pool";
export { account, session, user, verification } from "./schema";
export {
  createClippingsService,
  InvalidCursorError,
  InvalidUrlError,
  NoteTooLongError,
  noopJobPublisher,
  systemClock,
  type ClippingsPage,
  type ClippingsService,
  type Clock,
  type JobPublisher,
  type ListClippingsInput,
  type SaveClippingInput,
  type SaveClippingResult,
} from "./clippings/service";
