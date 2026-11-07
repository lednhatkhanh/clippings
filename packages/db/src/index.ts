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
  rateLimit,
  session,
  user,
  verification,
} from "./schema.ts";
export {
  CapReachedError,
  type BudgetGate,
  type Clock,
  type Embedder,
  type EmbeddingOwner,
  type EmbeddingPurpose,
  type FetchedPage,
  type JobPublisher,
  type PageFetcher,
  type PageSummary,
  type ResearchVerdict,
  type Summarizer,
  type SummarizerInput,
  type TagProposal,
} from "./clippings/ports.ts";
export {
  ChangeConflictError,
  ChangeNotFoundError,
  ChangeNotUndoableError,
  createChangesService,
  type AutoAppliedTag,
  type ChangesService,
  type UndoResult,
} from "./changes/service.ts";
export { gateChange, type GateDecision } from "./librarian/gate.ts";
export {
  LIBRARY_VIEW_ITEM_LIMIT,
  type LibraryView,
  type LibraryViewItem,
  type LibraryViewTag,
} from "./librarian/library-view.ts";
export {
  LibrarianInputError,
  LibrarianInvalidError,
  LibrarianNotFoundError,
  type ProposedChange,
  type ProposingActor,
} from "./librarian/plans.ts";
export {
  createLibraryService,
  type AppliedChange,
  type ClippingPlacement,
  type LibraryService,
  type LinkedClipping,
  type TagPlacement,
  type TagTopic,
} from "./librarian/library.ts";
export {
  ChangeNotSuggestedError,
  createLibrarianService,
  InvalidSuggestionCursorError,
  SuggestionStaleError,
  type FolderSummary,
  type LibrarianService,
  type ListSuggestionsInput,
  type PlannedChange,
  type ProposalResult,
  type ProposeOptions,
  type SuggestionsPage,
} from "./librarian/service.ts";
export {
  createClippingsService,
  EmptyNoteBodyError,
  IMPORT_DAILY_BUDGET,
  IMPORT_SPREAD_SECONDS,
  InvalidCursorError,
  InvalidTagColorError,
  InvalidTagsError,
  InvalidUrlError,
  MAX_BULK_CLIPPINGS,
  NoteBodyTooLongError,
  NotANoteError,
  NoteTooLongError,
  systemClock,
  TagNameTakenError,
  TitleTooLongError,
  TooManyClippingsError,
  type ClippingsExport,
  type ClippingText,
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
  type SaveNoteInput,
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
export {
  createUsageService,
  type ModelUsageEntry,
  type UsageBudget,
  type UsageService,
} from "./usage/service.ts";
export {
  createResearchService,
  type BriefForWriting,
  type BriefWriter,
  type QueueBriefInput,
  type RequestBriefNowResult,
  type ResearchService,
} from "./research/index.ts";
export { createLessonsService, type LessonsServiceDeps } from "./lessons/service.ts";
export {
  LESSON_NOTE_EXCERPT_LENGTH,
  LESSON_PAST_LIMIT,
  LESSON_RECENT_DAYS,
  LESSON_RECENT_LIMIT,
  LESSON_WRITER_STALE_MS,
  type ClaimLessonResult,
  type CompletedLesson,
  type LessonMaterial,
  type LessonMaterialItem,
  type LessonMaterialTag,
  type LessonsService,
  type PastLesson,
} from "./lessons/types.ts";
