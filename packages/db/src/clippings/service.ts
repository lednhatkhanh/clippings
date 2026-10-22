import {
  constructNow,
  isAfter,
  isBefore,
  isValid,
  parseISO,
  subDays,
  subHours,
  subSeconds,
} from "date-fns";
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  getColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type pg from "pg";

import {
  formatIsoUtc,
  MAX_NOTE_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CLIPPING,
  isTagColor,
  normalizeTagName,
  normalizeTagNames,
  parseWebUrl,
  tagNameKey,
  SEARCH_RESULT_LIMIT,
  type Clipping,
  type ClippingSource,
  type SearchHit,
  type SearchSort,
  type Tag,
  type TagSummary,
  type TextSegment,
} from "@clippings/shared";

import { createDatabase, type Database } from "../database.ts";
import {
  clippings,
  clippingTags,
  clippingTagSuggestions,
  clippingTexts,
  EMBEDDING_DIMENSIONS,
  tags,
  userSettings,
} from "../schema.ts";
import type {
  Clock,
  Embedder,
  EmbeddingPurpose,
  JobPublisher,
  PageFetcher,
  PageSummary,
  Summarizer,
} from "./ports.ts";

export const systemClock: Clock = { now: () => constructNow(undefined) };

export interface SaveClippingInput {
  url: string;
  note?: string;
  /** Tag names, created for the user when they have no such tag yet. */
  tags?: readonly string[];
  source: ClippingSource;
  clientId?: string;
}

export type SaveClippingResult = { status: "created" | "existing"; clipping: Clipping };

/** What the user can change on a clipping. A field left out stays as it is. */
export interface UpdateClippingInput {
  /**
   * The user's own title. An empty or whitespace-only string, or null, goes back to the page's
   * title.
   */
  title?: string | null;
  note?: string;
  /** Every tag the clipping should carry, by name: the ones left out are taken off. */
  tags?: readonly string[];
}

export interface ListClippingsInput {
  cursor?: string;
  limit?: number;
  /** Only clippings with every one of these tags, by name, ignoring case. */
  tags?: readonly string[];
  /** Only clippings saved from these; all of them when empty or left out. */
  sources?: readonly ClippingSource[];
}

/** A filtered list of the user's clippings, newest saved first, pinned or not. */
export interface ListSavedClippingsInput {
  cursor?: string;
  limit?: number;
  /** Only clippings with every one of these tags, by name, ignoring case. */
  tags?: readonly string[];
  /** Only clippings saved at or after this time. */
  savedSince?: Date;
  /** Only clippings saved before this time. */
  savedBefore?: Date;
  /** True: only pinned clippings. False: only unpinned ones. Left out: both. */
  pinned?: boolean;
}

export interface SavedClippingsPage {
  items: Clipping[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/** The most clippings `tagClippings` changes in one call. */
export const MAX_BULK_CLIPPINGS = 100;

/** Tags to put on and take off a set of clippings; each keeps its other tags. */
export interface TagClippingsInput {
  add?: readonly string[];
  remove?: readonly string[];
}

export interface TagClippingsResult {
  /** How many clippings now carry a different set of tags. */
  changed: number;
  /** The ids that aren't one of the user's clippings, in the order given. */
  notFound: string[];
}

export interface SearchClippingsInput {
  /** Words to find, in web-search syntax: `"a phrase"`, `-without`, `this or that`. */
  q: string;
  /** Only clippings with every one of these tags, by name, ignoring case. */
  tags?: readonly string[];
  /** Only clippings saved from these; all of them when empty or left out. */
  sources?: readonly ClippingSource[];
  sort?: SearchSort;
  limit?: number;
}

export interface SearchResults {
  items: SearchHit[];
}

export interface ClippingsPage {
  /**
   * The user's pinned clippings that match the filters, most recently pinned first. Only the
   * first page (no cursor) has them; later pages have none.
   */
  pinned: Clipping[];
  /** The rest, newest first: pinned clippings are not repeated here. */
  items: Clipping[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/** A clipping as it appears in the user's data export: its tags by name. */
export type ExportedClipping = Omit<Clipping, "tags" | "suggestedTags"> & { tags: string[] };

/** The page text saved with a clipping, when it was read, and the clipping's url and shown title. */
export interface ClippingText {
  id: string;
  url: string;
  title: string;
  text: string;
  fetchedAt: string;
}

/** One bookmark to import. A `ParsedBookmark` from `@clippings/shared` fits. */
export interface ImportItem {
  url: string;
  /** When the user saved it elsewhere; null or implausible dates are replaced by now. */
  addedAt: Date | null;
  /** The folders it sat in, outermost first. */
  folders: readonly string[];
}

export interface ImportOptions {
  /** Tag each clipping with the names of its folders. */
  foldersAsTags: boolean;
}

/** What an import did, or would do. */
export interface ImportCounts {
  /** Clippings made new, counting a deleted clipping of the same page that starts over. */
  created: number;
  /** Pages the user already has a live clipping of. */
  existing: number;
  /** Bookmarks that aren't web pages. */
  skipped: number;
}

/** Everything the user has saved, for them to keep. */
export interface ClippingsExport {
  exportedAt: string;
  clippings: ExportedClipping[];
}

export interface ClippingsServiceDeps {
  pool: pg.Pool;
  jobs: JobPublisher;
  clock: Clock;
  fetcher: PageFetcher;
  summarizer: Summarizer;
  embedder: Embedder;
}

export interface EnrichClippingOptions {
  /**
   * This delivery is the last one the queue will make. A failure then marks the clipping
   * `failed` instead of throwing, which would only ask for a retry that never comes.
   */
  lastAttempt?: boolean;
}

/** How an `enrichClipping` call ended. */
export type EnrichmentOutcome =
  /** The page was read and the clipping is ready. */
  | "ready"
  /** The clipping was not pending (already read, failed, or gone), so nothing was done. */
  | "skipped"
  /** Reading failed on the last attempt, so the clipping is now failed. */
  | "failed";

// Every column but `search_tsv` and `embedding`, which only search reads.
const { searchTsv, embedding, ...clippingColumns } = getColumns(clippings);

type ClippingRow = Omit<typeof clippings.$inferSelect, "searchTsv" | "embedding">;

/** Not deleted: every read and edit the user makes sees only these. */
const live = isNull(clippings.deletedAt);

/** A clipping starting over has no link verdict yet: the last one was about another life of the row. */
const noLinkVerdict = { linkCheckedAt: null, linkFailures: 0, linkDeadSince: null };

/** The columns every status change writes together. */
const statusChange = (status: ClippingRow["status"], at: Date) => ({
  status,
  statusChangedAt: at,
  updatedAt: at,
});

const toClipping = (row: ClippingRow, tagList: Tag[] = []): Clipping => ({
  id: row.id,
  url: row.url,
  urlNormalized: row.urlNormalized,
  title: row.userTitle ?? row.title,
  pageTitle: row.title,
  titleEdited: row.userTitle !== null,
  note: row.note,
  summary: row.summary,
  excerpt: row.excerpt,
  status: row.status,
  source: row.source,
  clientId: row.clientId,
  tags: tagList,
  pinned: row.pinnedAt !== null,
  linkDeadSince: row.linkDeadSince ? formatIsoUtc(row.linkDeadSince) : null,
  suggestedTags: [],
  createdAt: formatIsoUtc(row.createdAt),
});

/** The title to show, in SQL: the user's own, else the page's. */
const shownTitle = sql`coalesce(${clippings.userTitle}, ${clippings.title})`;

const fromSources = (sources: readonly ClippingSource[] = []) =>
  sources.length > 0 ? inArray(clippings.source, [...sources]) : undefined;

/** What `db.transaction` hands its callback. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A tag as the DTO has it. */
const tagColumns = { id: tags.id, name: tags.name, color: tags.color };

/** A tag name as uniqueness sees it, in SQL: `lower()`, as the unique index has it. */
const tagKey = (name: SQLWrapper) => sql`lower(${name})`;

/**
 * The names, lowercased by Postgres. Every comparison with stored names lowercases on this side
 * too: JavaScript's `toLowerCase` and Postgres's `lower` disagree on letters such as "İ".
 */
const keysOf = (names: readonly string[]) =>
  sql`(select distinct lower(name) from unnest(${sql.param([...names])}::text[]) as name)`;

/**
 * The user's clippings that carry every one of these tags, ignoring case; undefined when there
 * are none to match. A name the user has no tag for matches nothing.
 */
function taggedWithAll(db: Database, userId: string, names: readonly string[] = []) {
  const wanted = normalizeTagNames(names);
  if (wanted.length === 0) return undefined;
  const keys = keysOf(wanted);
  const tagged = db
    .select({ id: clippingTags.clippingId })
    .from(clippingTags)
    .innerJoin(tags, eq(tags.id, clippingTags.tagId))
    .where(and(eq(clippingTags.userId, userId), sql`${tagKey(tags.name)} in ${keys}`))
    .groupBy(clippingTags.clippingId)
    // Each key is at most one of the user's tags, so a clipping with all of them has one link each.
    .having(sql`count(*) = (select count(*) from ${keys} as wanted)`);
  return inArray(clippings.id, tagged);
}

/**
 * The query as Postgres reads it: web-search syntax, with the last word also matching as a
 * prefix, so results appear while it is still being typed. A last word that is an operator, a
 * negation or inside an open quote is left to web-search syntax.
 */
function keywordQuery(text: string): SQL {
  const words = text.split(/\s+/);
  const last = words.at(-1) ?? "";
  const inOpenQuote = (text.split('"').length - 1) % 2 === 1;
  if (!/^[\p{L}\p{N}]+$/u.test(last) || last.toLowerCase() === "or" || inOpenQuote) {
    return sql`websearch_to_tsquery('simple', ${text})`;
  }
  const prefix = sql`to_tsquery('simple', ${`${last}:*`})`;
  const head = words.slice(0, -1).join(" ");
  return head ? sql`(websearch_to_tsquery('simple', ${head}) && ${prefix})` : prefix;
}

/**
 * The shown title close to every word of the query, a typo or so apart (`<%`, word similarity of at
 * least 0.6). Undefined for a query with a phrase or an excluded word, whose meaning plain words
 * can't carry, and for one with no words.
 */
function typoInTitle(text: string): SQL | undefined {
  if (text.includes('"') || text.split(/\s+/).some((word) => word.startsWith("-")))
    return undefined;
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return and(...words.map((word) => sql`${word} <% ${shownTitle}`));
}

// `ts_headline` marks each matched term with these; neither occurs in text people write.
const MARK_START = "\u0001";
const MARK_END = "\u0002";
const MARKS = `StartSel=${MARK_START}, StopSel=${MARK_END}`;
const TITLE_HEADLINE = `${MARKS}, HighlightAll=true`;
const SNIPPET_HEADLINE = `${MARKS}, MaxWords=24, MinWords=12`;

/** The text without the marker characters, so a page that contains them can't fake a match. */
const unmarked = (text: SQLWrapper) => sql`translate(${text}, ${MARK_START + MARK_END}, '')`;

/** Splits a headline from `ts_headline` into runs of text, marking the matched terms. */
function toSegments(headline: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const push = (text: string | undefined, match: boolean) => {
    if (text) segments.push({ text, match });
  };
  headline.split(MARK_START).forEach((chunk, index) => {
    if (index === 0) return push(chunk, false);
    const [marked, rest] = chunk.split(MARK_END);
    push(marked, true);
    push(rest, false);
  });
  return segments;
}

/**
 * Reciprocal rank fusion's k: a result's score is the sum of 1 / (k + its rank) over the
 * rankings it appears in. 60 is the value from the original paper, and it keeps one ranking's top
 * result from drowning out a result that both rankings place well.
 */
const RRF_K = 60;
/** Most clippings the meaning half of search contributes, nearest first. */
const SEMANTIC_CANDIDATES = 50;
/**
 * Farthest cosine distance (1 − similarity) at which a clipping still counts as close in meaning:
 * past it, the nearest neighbours of a query are only the least unrelated. A first guess for
 * voyage-4 (ADR 0001), to tune against real searches.
 */
const MAX_SEMANTIC_DISTANCE = 0.6;
/** Most related clippings the detail page shows. */
const RELATED_LIMIT = 5;
// One call each, in turn: 50 fit the sweep route's 60 s with room to spare.
const EMBED_BATCH_SIZE = 50;

/** Has an embedding within `MAX_SEMANTIC_DISTANCE` of the vector `distance` measures from. */
const closeInMeaning = (distance: SQL) =>
  and(isNotNull(embedding), sql`${distance} < ${MAX_SEMANTIC_DISTANCE}`);

/** What enrichment embeds: what the page is, not the user's note, which they can edit at will. */
const documentText = ({
  title,
  summary,
  excerpt,
}: Pick<ClippingRow, "title" | "summary" | "excerpt">) =>
  [title, summary, excerpt].filter(Boolean).join("\n\n");

/** How long a clipping can sit pending or failed before the sweep requests it again. */
const STUCK_AFTER_HOURS = 1;
const SWEEP_BATCH_SIZE = 100;
/**
 * How long a deleted clipping is kept before the purge removes it for good: far past the Undo
 * toast's 8 seconds, so a purge never races an Undo.
 */
const PURGE_AFTER_HOURS = 24;
const PURGE_BATCH_SIZE = 1000;

/** How long a clipping's link is left alone after a check. */
const LINK_RECHECK_AFTER_DAYS = 7;
/** Checks in a row that must find a page gone before it is marked dead: one bad day is not rot. */
const LINK_DEAD_AFTER_FAILURES = 3;
/** Links checked at once, so a run stays short without hammering one network path. */
const LINK_CHECK_CONCURRENCY = 10;

/**
 * Most imported clippings the daily drain requests. QStash's free tier allows 1,000 messages a
 * day, and every delivery counts, retries included (at most 4 per job, usually 1). 400 jobs cost
 * about 440 messages, which leaves more than half the day for new saves, their retries and the
 * stuck sweep (up to 100 jobs).
 */
export const IMPORT_DAILY_BUDGET = 400;
/**
 * The window the drain spreads its jobs over: 20 of the 24 hours until the next run. New saves
 * are published immediately, so they are never queued behind the backlog.
 */
export const IMPORT_SPREAD_SECONDS = 20 * 60 * 60;
/** Rows per insert, so a statement stays far below Postgres's 65,535 parameters. */
const IMPORT_CHUNK_SIZE = 500;
/** Bookmarks dated before this are taken for a bad ADD_DATE: the web had no bookmarks then. */
const EARLIEST_BOOKMARK = parseISO("1990-01-01T00:00:00.000Z");

/** Most tag names the model's call is given: the user's most-used ones. */
const USER_TAGS_FOR_SUGGESTIONS = 50;
/** Nearest clippings whose tags are counted, and how many of them must share a tag. */
const NEIGHBOURS_VOTING = 5;
const NEIGHBOUR_VOTES_NEEDED = 2;
/** Most tags the neighbour vote suggests, most-voted first, so the row of chips stays short. */
const NEIGHBOUR_SUGGESTION_LIMIT = 5;

/** The items in runs of at most `size`. */
function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) yield items.slice(start, start + size);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page boundary: the clipping the previous page ended on. Opaque to callers. */
const encodeCursor = (row: ClippingRow) =>
  Buffer.from(JSON.stringify({ at: formatIsoUtc(row.createdAt), id: row.id })).toString(
    "base64url",
  );

function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      at?: unknown;
      id?: unknown;
    };
    const at = parseISO(String(parsed.at));
    if (isValid(at) && typeof parsed.id === "string" && UUID.test(parsed.id)) {
      return { at, id: parsed.id };
    }
  } catch {
    // fall through to the error below
  }
  throw new InvalidCursorError();
}

/** Rows saved after the page boundary the cursor names, in newest-first order. */
const afterCursor = (after: { at: Date; id: string } | null) =>
  after
    ? or(
        lt(clippings.createdAt, after.at),
        and(eq(clippings.createdAt, after.at), lt(clippings.id, after.id)),
      )
    : undefined;

export class InvalidCursorError extends Error {
  constructor() {
    super("Not a page cursor");
    this.name = "InvalidCursorError";
  }
}

export class NoteTooLongError extends Error {
  constructor() {
    super(`A note can be at most ${MAX_NOTE_LENGTH} characters`);
    this.name = "NoteTooLongError";
  }
}

export class TitleTooLongError extends Error {
  constructor() {
    super(`A title can be at most ${MAX_TITLE_LENGTH} characters`);
    this.name = "TitleTooLongError";
  }
}

export class InvalidTagsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTagsError";
  }
}

/** The names as stored, or an error when one is too long or there are too many. */
function checkedTagNames(names: readonly string[]): string[] {
  const kept = normalizeTagNames(names);
  if (kept.some((name) => name.length > MAX_TAG_LENGTH)) {
    throw new InvalidTagsError(`A tag can be at most ${MAX_TAG_LENGTH} characters`);
  }
  if (kept.length > MAX_TAGS_PER_CLIPPING) {
    throw new InvalidTagsError(`A clipping can have at most ${MAX_TAGS_PER_CLIPPING} tags`);
  }
  return kept;
}

export class TooManyClippingsError extends Error {
  constructor() {
    super(`At most ${MAX_BULK_CLIPPINGS} clippings can be changed at once`);
    this.name = "TooManyClippingsError";
  }
}

export class InvalidTagColorError extends Error {
  constructor(color: string) {
    super(`Not a tag color: ${color}`);
    this.name = "InvalidTagColorError";
  }
}

export class TagNameTakenError extends Error {
  constructor(name: string) {
    super(`You already have a tag named ${name}`);
    this.name = "TagNameTakenError";
  }
}

/** Postgres refused a row that breaks a unique index: drizzle wraps its error as the cause. */
function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value ? value.code : undefined;
  return code(error) === "23505" || (error instanceof Error && code(error.cause) === "23505");
}

export class InvalidUrlError extends Error {
  constructor(url: string) {
    super(`Not a web address: ${url}`);
    this.name = "InvalidUrlError";
  }
}

/**
 * The rules about clippings. Every operation a user triggers takes the acting user and scopes its
 * queries by them, so no caller can reach another user's rows. `enrichClipping`, `sweepStuck`,
 * `embedMissing`, `purgeDeleted` and `checkLinks` are the exceptions: they are system jobs, reached only through the signed QStash
 * handler and the cron secret, and they act across users.
 */
export function createClippingsService({
  pool,
  jobs,
  clock,
  fetcher,
  summarizer,
  embedder,
}: ClippingsServiceDeps) {
  const db = createDatabase(pool);

  /** The embedder's vector, checked to fit the column, so a wrong model fails here and not in SQL. */
  async function embed(text: string, purpose: EmbeddingPurpose): Promise<number[]> {
    const vector = await embedder.embed(text, purpose);
    if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
      throw new Error(`Expected ${EMBEDDING_DIMENSIONS} numbers, got ${vector.length}`);
    }
    return vector;
  }

  /** The user's tags on each of these clippings, by name; a clipping with none is left out. */
  async function tagsOn(
    userId: string,
    clippingIds: readonly string[],
  ): Promise<Map<string, Tag[]>> {
    const byClipping = new Map<string, Tag[]>();
    if (clippingIds.length === 0) return byClipping;
    const rows = await db
      .select({
        clippingId: clippingTags.clippingId,
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(clippingTags)
      .innerJoin(tags, eq(tags.id, clippingTags.tagId))
      .where(
        and(eq(clippingTags.userId, userId), inArray(clippingTags.clippingId, [...clippingIds])),
      )
      .orderBy(tagKey(tags.name), tags.name);
    for (const { clippingId, ...tag } of rows) {
      byClipping.set(clippingId, [...(byClipping.get(clippingId) ?? []), tag]);
    }
    return byClipping;
  }

  /** The rows as clippings, each with its tags. */
  async function withTags(userId: string, rows: readonly ClippingRow[]): Promise<Clipping[]> {
    const byClipping = await tagsOn(
      userId,
      rows.map((row) => row.id),
    );
    return rows.map((row) => toClipping(row, byClipping.get(row.id)));
  }

  /** One row as a clipping, with its tags. */
  async function oneWithTags(userId: string, row: ClippingRow): Promise<Clipping> {
    const [clipping] = await withTags(userId, [row]);
    return clipping!;
  }

  /**
   * Makes `names` the clipping's tags, creating the ones the user doesn't have yet. A name matches
   * an existing tag ignoring case, so the tag keeps the spelling it was created with. The caller
   * has checked that the clipping is the user's.
   */
  async function setTags(tx: Transaction, userId: string, clippingId: string, names: string[]) {
    if (names.length > 0) {
      const createdAt = clock.now();
      await tx
        .insert(tags)
        // Always in the same order, so two saves creating the same tags can't deadlock on the
        // unique index, each waiting for a name the other inserted first.
        .values(names.toSorted().map((name) => ({ userId, name, createdAt })))
        .onConflictDoNothing();
    }
    const wanted =
      names.length > 0
        ? await tx
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.userId, userId), sql`${tagKey(tags.name)} in ${keysOf(names)}`))
        : [];
    const ids = wanted.map((tag) => tag.id);
    await tx
      .delete(clippingTags)
      .where(
        and(
          eq(clippingTags.clippingId, clippingId),
          eq(clippingTags.userId, userId),
          ids.length > 0 ? sql`${clippingTags.tagId} <> all(${sql.param(ids)}::uuid[])` : undefined,
        ),
      );
    if (ids.length > 0) {
      await tx
        .insert(clippingTags)
        .values(ids.map((tagId) => ({ clippingId, tagId, userId })))
        .onConflictDoNothing();
    }
  }

  /** The user's tags, by name. */
  async function listTags(userId: string): Promise<Tag[]> {
    return db
      .select(tagColumns)
      .from(tags)
      .where(eq(tags.userId, userId))
      .orderBy(tagKey(tags.name), tags.name);
  }

  /** The user's tag with this name, ignoring case; null when they have none. */
  async function findTagByName(userId: string, name: string): Promise<Tag | null> {
    const [wanted] = normalizeTagNames([name]);
    if (!wanted) return null;
    const [found] = await db
      .select(tagColumns)
      .from(tags)
      .where(and(eq(tags.userId, userId), sql`${tagKey(tags.name)} in ${keysOf([wanted])}`));
    return found ?? null;
  }

  /** The user's tags, by name, each with how many of their clippings carry it. */
  async function listTagSummaries(userId: string): Promise<TagSummary[]> {
    return db
      .select({
        ...tagColumns,
        clippingCount: sql<number>`count(${clippings.id})::int`,
      })
      .from(tags)
      .leftJoin(clippingTags, eq(clippingTags.tagId, tags.id))
      .leftJoin(clippings, and(eq(clippings.id, clippingTags.clippingId), live))
      .where(eq(tags.userId, userId))
      .groupBy(tags.id)
      .orderBy(tagKey(tags.name), tags.name);
  }

  /**
   * Gives the tag a new name on every clipping that carries it. Returns the tag as it now
   * stands, or null when the user has no such tag. Throws when the name is empty or too long, or
   * another of the user's tags has it, ignoring case.
   */
  async function renameTag(userId: string, tagId: string, name: string): Promise<Tag | null> {
    const [newName] = checkedTagNames([name]);
    if (!newName) throw new InvalidTagsError("A tag needs a name");
    if (!UUID.test(tagId)) return null;
    try {
      const [renamed] = await db
        .update(tags)
        .set({ name: newName })
        .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
        .returning(tagColumns);
      return renamed ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) throw new TagNameTakenError(newName);
      throw error;
    }
  }

  /**
   * Moves every clipping tagged `sourceId` to `targetId`, then removes the source tag. A clipping
   * that already has both keeps one link to the target. Returns false, changing nothing, unless
   * both are the user's tags and they differ. A save that tags a clipping with the source while
   * the merge runs waits for it, then fails once the source is gone.
   */
  async function mergeTag(userId: string, sourceId: string, targetId: string): Promise<boolean> {
    if (!UUID.test(sourceId) || !UUID.test(targetId) || sourceId === targetId) return false;
    return db.transaction(async (tx) => {
      const found = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), inArray(tags.id, [sourceId, targetId])))
        // Locked, so a rename or delete of either waits until the merge is done. In id order, so
        // two merges of the same pair in opposite directions can't deadlock.
        .orderBy(tags.id)
        .for("update");
      if (found.length !== 2) return false;
      await tx
        .insert(clippingTags)
        .select(
          tx
            .select({
              clippingId: clippingTags.clippingId,
              tagId: sql`${targetId}::uuid`.as("tag_id"),
              userId: clippingTags.userId,
            })
            .from(clippingTags)
            .where(and(eq(clippingTags.tagId, sourceId), eq(clippingTags.userId, userId))),
        )
        .onConflictDoNothing();
      // The source's links go with it: `clipping_tags` cascades on the tag.
      await tx.delete(tags).where(and(eq(tags.id, sourceId), eq(tags.userId, userId)));
      return true;
    });
  }

  /**
   * Removes the tag from every clipping and from the user's tags; the clippings stay. Returns
   * false when the user has no such tag.
   */
  async function deleteTag(userId: string, tagId: string): Promise<boolean> {
    if (!UUID.test(tagId)) return false;
    const deleted = await db
      .delete(tags)
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning({ id: tags.id });
    return deleted.length > 0;
  }

  /**
   * Gives the tag one of `TAG_COLORS`, by name. Returns the tag as it now stands, or null when
   * the user has no such tag. Throws on a name that isn't a tag color.
   */
  async function setTagColor(userId: string, tagId: string, color: string): Promise<Tag | null> {
    if (!isTagColor(color)) throw new InvalidTagColorError(color);
    if (!UUID.test(tagId)) return null;
    const [updated] = await db
      .update(tags)
      .set({ color })
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)))
      .returning(tagColumns);
    return updated ?? null;
  }

  async function saveClipping(
    userId: string,
    input: SaveClippingInput,
  ): Promise<SaveClippingResult> {
    const parsed = parseWebUrl(input.url);
    if (!parsed) throw new InvalidUrlError(input.url);
    const note = input.note ?? "";
    if (note.length > MAX_NOTE_LENGTH) throw new NoteTooLongError();
    const tagNames = checkedTagNames(input.tags ?? []);

    const now = clock.now();
    const { url, normalized } = parsed;
    const fresh = {
      url,
      title: url,
      userTitle: null,
      pinnedAt: null,
      note,
      summary: null,
      excerpt: null,
      source: input.source,
      clientId: input.clientId ?? null,
      deletedAt: null,
      createdAt: now,
      ...noLinkVerdict,
      ...statusChange("pending", now),
    };
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(clippings)
        .values({ userId, urlNormalized: normalized, ...fresh })
        // A deleted clipping of the same page still holds its row: saving again starts it over,
        // tags, suggestions, title and pin included.
        .onConflictDoUpdate({
          target: [clippings.userId, clippings.urlNormalized],
          set: fresh,
          setWhere: isNotNull(clippings.deletedAt),
        })
        .returning(clippingColumns);
      if (row) {
        await setTags(tx, userId, row.id, tagNames);
        await tx
          .delete(clippingTagSuggestions)
          .where(
            and(
              eq(clippingTagSuggestions.clippingId, row.id),
              eq(clippingTagSuggestions.userId, userId),
            ),
          );
        await tx
          .delete(clippingTexts)
          .where(and(eq(clippingTexts.clippingId, row.id), eq(clippingTexts.userId, userId)));
      }
      return row;
    });

    if (created) {
      // The save stands even if the queue is down: the daily sweep requests the job again.
      await jobs.requestEnrichment(created.id).catch((error: unknown) => {
        console.error(`Couldn't request enrichment of clipping ${created.id}`, error);
      });
      return { status: "created", clipping: await oneWithTags(userId, created) };
    }

    // Already saved: returned as it stands, with its own note and tags.
    const [existing] = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.userId, userId), eq(clippings.urlNormalized, normalized)));
    return { status: "existing", clipping: await oneWithTags(userId, existing!) };
  }

  async function listClippings(
    userId: string,
    { cursor, limit = 20, sources, tags: tagNames }: ListClippingsInput,
  ): Promise<ClippingsPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const matching = and(
      eq(clippings.userId, userId),
      live,
      fromSources(sources),
      taggedWithAll(db, userId, tagNames),
    );
    // The pinned group heads the first page only. `nulls last` is how the partial index sorts.
    const pinnedRows = after
      ? []
      : await db
          .select(clippingColumns)
          .from(clippings)
          .where(and(matching, isNotNull(clippings.pinnedAt)))
          .orderBy(sql`${clippings.pinnedAt} desc nulls last`, desc(clippings.id));
    // One extra row says whether another page follows without a second query.
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(matching, isNull(clippings.pinnedAt), afterCursor(after)))
      .orderBy(desc(clippings.createdAt), desc(clippings.id))
      .limit(limit + 1);

    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const [pinned, items] = await Promise.all([
      withTags(userId, pinnedRows),
      withTags(userId, pageRows),
    ]);
    return {
      pinned,
      items,
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * One newest-saved-first list of the user's clippings that pages without gaps, pinned ones
   * among the rest by when they were saved. Unlike `listClippings` it sets no pinned group apart,
   * so a filter on `pinned` and on the save time is a plain filter.
   */
  async function listSavedClippings(
    userId: string,
    {
      cursor,
      limit = 20,
      tags: tagNames,
      savedSince,
      savedBefore,
      pinned,
    }: ListSavedClippingsInput,
  ): Promise<SavedClippingsPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    // One extra row says whether another page follows without a second query.
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          live,
          taggedWithAll(db, userId, tagNames),
          savedSince ? gte(clippings.createdAt, savedSince) : undefined,
          savedBefore ? lt(clippings.createdAt, savedBefore) : undefined,
          pinned === undefined
            ? undefined
            : pinned
              ? isNotNull(clippings.pinnedAt)
              : isNull(clippings.pinnedAt),
          afterCursor(after),
        ),
      )
      .orderBy(desc(clippings.createdAt), desc(clippings.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: await withTags(userId, pageRows),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * The user's clippings that match `q` by its words or by its meaning, best match first or newest
   * first. Words rank title over note over excerpt, and a title one typo away from the query
   * matches too, after every exact match. Words match as written, in any language: nothing is
   * stemmed. Meaning ranks by how close the clipping's embedding is to the query's. The two
   * rankings are merged by reciprocal rank fusion, so a clipping that matches both comes first.
   * When the query can't be embedded, search falls back to words alone.
   */
  async function searchClippings(
    userId: string,
    {
      q,
      tags: tagNames,
      sources,
      sort = "relevance",
      limit = SEARCH_RESULT_LIMIT,
    }: SearchClippingsInput,
  ): Promise<SearchResults> {
    const text = q.trim().slice(0, MAX_QUERY_LENGTH).trim();
    if (!text) return { items: [] };

    const queryVector = await embed(text, "query").catch((error: unknown) => {
      console.error("Couldn't embed the search query; searching by words alone", error);
      return null;
    });

    const query = keywordQuery(text);
    const scope = and(
      eq(clippings.userId, userId),
      live,
      fromSources(sources),
      taggedWithAll(db, userId, tagNames),
    );

    // Every clipping that matches the words, ranked.
    const byWords = db.$with("by_words").as(
      db
        .select({
          id: clippings.id,
          rank: sql<number>`row_number() over (order by ts_rank_cd(${searchTsv}, ${query}) desc, word_similarity(${text}, ${shownTitle}) desc, ${clippings.createdAt} desc, ${clippings.id} desc)`.as(
            "words_rank",
          ),
        })
        .from(clippings)
        .where(and(scope, or(sql`${searchTsv} @@ ${query}`, typoInTitle(text)))),
    );

    // The clippings nearest the query in meaning, close enough to count, ranked.
    const distance = queryVector ? cosineDistance(embedding, queryVector) : sql`null::float8`;
    const byMeaning = db.$with("by_meaning").as(
      db
        .select({
          id: clippings.id,
          rank: sql<number>`row_number() over (order by ${distance}, ${clippings.createdAt} desc, ${clippings.id} desc)`.as(
            "meaning_rank",
          ),
        })
        .from(clippings)
        .where(queryVector ? and(scope, closeInMeaning(distance)) : sql`false`)
        .orderBy(distance, desc(clippings.createdAt), desc(clippings.id))
        .limit(SEMANTIC_CANDIDATES),
    );

    const fused = sql<number>`coalesce(1.0 / (${RRF_K} + ${byWords.rank}), 0) + coalesce(1.0 / (${RRF_K} + ${byMeaning.rank}), 0)`;
    const matches = (column: SQLWrapper) => sql`to_tsvector('simple', ${column}) @@ ${query}`;
    const excerpt = sql`coalesce(${clippings.excerpt}, '')`;
    const rows = await db
      .with(byWords, byMeaning)
      .select({
        ...clippingColumns,
        titleHeadline: sql<string>`ts_headline('simple', ${unmarked(shownTitle)}, ${query}, ${TITLE_HEADLINE})`,
        snippetHeadline: sql<string | null>`case
          when ${matches(clippings.note)}
            then ts_headline('simple', ${unmarked(clippings.note)}, ${query}, ${SNIPPET_HEADLINE})
          when ${matches(excerpt)}
            then ts_headline('simple', ${unmarked(excerpt)}, ${query}, ${SNIPPET_HEADLINE})
        end`,
      })
      .from(clippings)
      .leftJoin(byWords, eq(byWords.id, clippings.id))
      .leftJoin(byMeaning, eq(byMeaning.id, clippings.id))
      .where(and(eq(clippings.userId, userId), or(isNotNull(byWords.id), isNotNull(byMeaning.id))))
      .orderBy(
        // On a tie, a match on the words wins: it is the one the user can see.
        ...(sort === "relevance" ? [desc(fused), sql`${byWords.rank} asc nulls last`] : []),
        desc(clippings.createdAt),
        desc(clippings.id),
      )
      .limit(limit);

    const byClipping = await tagsOn(
      userId,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map(({ titleHeadline, snippetHeadline, ...row }) => ({
        clipping: toClipping(row, byClipping.get(row.id)),
        highlights: {
          title: toSegments(titleHeadline),
          snippet: snippetHeadline === null ? null : toSegments(snippetHeadline),
        },
      })),
    };
  }

  /**
   * The user's other clippings nearest in meaning to this one, nearest first, by exact cosine
   * distance (no ANN index, ADR 0001). Empty when the user has no such clipping or it has no
   * embedding yet. At most `limit` of them, five by default.
   */
  async function relatedClippings(
    userId: string,
    clippingId: string,
    limit: number = RELATED_LIMIT,
  ): Promise<Clipping[]> {
    if (!UUID.test(clippingId)) return [];
    const target = db
      .select({ embedding })
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
    const distance = cosineDistance(embedding, target);
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          live,
          sql`${clippings.id} <> ${clippingId}`,
          closeInMeaning(distance),
        ),
      )
      .orderBy(asc(distance), desc(clippings.createdAt), desc(clippings.id))
      .limit(limit);
    return withTags(userId, rows);
  }

  /**
   * All of the user's live clippings with their notes and tag names, newest first and unpaged,
   * stamped with the time of the export.
   */
  async function exportClippings(userId: string): Promise<ClippingsExport> {
    const exportedAt = formatIsoUtc(clock.now());
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.userId, userId), live))
      .orderBy(desc(clippings.createdAt), desc(clippings.id));
    return {
      exportedAt,
      clippings: (await withTags(userId, rows)).map((clipping) => {
        const { suggestedTags: _suggestedTags, ...exported } = clipping;
        return { ...exported, tags: clipping.tags.map((tag) => tag.name) };
      }),
    };
  }

  /**
   * The page text the last successful reading of the user's clipping saved, with the time it was
   * read and the clipping's url and title as shown, or null when the user has no such live
   * clipping or it has no saved text.
   */
  async function getClippingText(userId: string, clippingId: string): Promise<ClippingText | null> {
    if (!UUID.test(clippingId)) return null;
    const [row] = await db
      .select({
        url: clippings.url,
        title: sql<string>`${shownTitle}`,
        text: clippingTexts.text,
        fetchedAt: clippingTexts.fetchedAt,
      })
      .from(clippingTexts)
      .innerJoin(
        clippings,
        and(eq(clippings.id, clippingTexts.clippingId), eq(clippings.userId, clippingTexts.userId)),
      )
      .where(and(eq(clippingTexts.clippingId, clippingId), eq(clippingTexts.userId, userId), live));
    return row
      ? {
          id: clippingId,
          url: row.url,
          title: row.title,
          text: row.text,
          fetchedAt: formatIsoUtc(row.fetchedAt),
        }
      : null;
  }

  /**
   * Changes what the user wrote on their clipping: its title, note, tags or any of them. Returns
   * it as it now stands, or null when the user has no such clipping.
   */
  async function updateClipping(
    userId: string,
    clippingId: string,
    { title, note, tags: tagList }: UpdateClippingInput,
  ): Promise<Clipping | null> {
    const userTitle = title === undefined ? undefined : (title?.trim() ?? "") || null;
    if (userTitle && userTitle.length > MAX_TITLE_LENGTH) throw new TitleTooLongError();
    if (note !== undefined && note.length > MAX_NOTE_LENGTH) throw new NoteTooLongError();
    const tagNames = tagList === undefined ? undefined : checkedTagNames(tagList);
    if (!UUID.test(clippingId)) return null;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(clippings)
        .set({
          ...(userTitle === undefined ? {} : { userTitle }),
          ...(note === undefined ? {} : { note }),
          updatedAt: clock.now(),
        })
        .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live))
        .returning(clippingColumns);
      if (row && tagNames) await setTags(tx, userId, row.id, tagNames);
      return row;
    });
    return updated ? oneWithTags(userId, updated) : null;
  }

  /**
   * Puts the `add` tags on each of the user's clippings and takes the `remove` tags off, in one
   * transaction: each clipping keeps its other tags, and a tag the user doesn't have yet is
   * created. Names match ignoring case. Ids that aren't the user's live clippings are not touched
   * and come back in `notFound`. Throws, changing nothing, when a name is too long, a clipping
   * would end up with too many tags, or a name is both added and removed.
   */
  async function tagClippings(
    userId: string,
    clippingIds: readonly string[],
    { add = [], remove = [] }: TagClippingsInput,
  ): Promise<TagClippingsResult> {
    const ids = [...new Set(clippingIds)];
    if (ids.length > MAX_BULK_CLIPPINGS) throw new TooManyClippingsError();
    const addNames = checkedTagNames(add);
    const removeNames = normalizeTagNames(remove);
    const removing = new Set(removeNames.map(tagNameKey));
    if (addNames.some((name) => removing.has(tagNameKey(name)))) {
      throw new InvalidTagsError("A tag can't be added and removed in the same call");
    }
    const valid = ids.filter((id) => UUID.test(id));
    return db.transaction(async (tx) => {
      const owned = new Set(
        valid.length === 0
          ? []
          : (
              await tx
                .select({ id: clippings.id })
                .from(clippings)
                .where(and(eq(clippings.userId, userId), live, inArray(clippings.id, valid)))
                // Locked, so a delete or another tagging of them waits. `no key update`, not
                // `update`: linking a tag takes a key-share lock on the clipping for the foreign
                // key, which `update` would block while a merge waits on us. In id order, so two
                // calls over the same clippings can't deadlock.
                .orderBy(clippings.id)
                .for("no key update")
            ).map((row) => row.id),
      );
      const notFound = ids.filter((id) => !owned.has(id));
      if (owned.size === 0) return { changed: 0, notFound };

      if (addNames.length > 0) {
        await tx
          .insert(tags)
          // Sorted, as in `setTags`, so two calls creating the same tags can't deadlock.
          .values(addNames.toSorted().map((name) => ({ userId, name, createdAt: clock.now() })))
          .onConflictDoNothing();
      }
      const tagIdsNamed = async (names: string[]) =>
        names.length === 0
          ? new Set<string>()
          : new Set(
              (
                await tx
                  .select({ id: tags.id })
                  .from(tags)
                  .where(
                    and(eq(tags.userId, userId), sql`${tagKey(tags.name)} in ${keysOf(names)}`),
                  )
              ).map((tag) => tag.id),
            );
      const addIds = await tagIdsNamed(addNames);
      const removeIds = await tagIdsNamed(removeNames);
      // The check above compares in JavaScript; Postgres's `lower` can see two names as one tag.
      if ([...addIds].some((tagId) => removeIds.has(tagId))) {
        throw new InvalidTagsError("A tag can't be added and removed in the same call");
      }

      const links = await tx
        .select({ clippingId: clippingTags.clippingId, tagId: clippingTags.tagId })
        .from(clippingTags)
        .where(and(eq(clippingTags.userId, userId), inArray(clippingTags.clippingId, [...owned])));
      const current = new Map<string, Set<string>>([...owned].map((id) => [id, new Set()]));
      for (const { clippingId, tagId } of links) current.get(clippingId)!.add(tagId);

      const toLink: { clippingId: string; tagId: string; userId: string }[] = [];
      const toUnlink: { clippingId: string; tagId: string }[] = [];
      const changedIds: string[] = [];
      for (const [clippingId, have] of current) {
        const gained = [...addIds].filter((tagId) => !have.has(tagId));
        const lost = [...removeIds].filter((tagId) => have.has(tagId));
        if (gained.length === 0 && lost.length === 0) continue;
        if (have.size + gained.length - lost.length > MAX_TAGS_PER_CLIPPING) {
          throw new InvalidTagsError(`A clipping can have at most ${MAX_TAGS_PER_CLIPPING} tags`);
        }
        changedIds.push(clippingId);
        toLink.push(...gained.map((tagId) => ({ clippingId, tagId, userId })));
        toUnlink.push(...lost.map((tagId) => ({ clippingId, tagId })));
      }
      if (toLink.length > 0) await tx.insert(clippingTags).values(toLink).onConflictDoNothing();
      if (toUnlink.length > 0) {
        await tx
          .delete(clippingTags)
          .where(
            and(
              eq(clippingTags.userId, userId),
              inArray(clippingTags.clippingId, [
                ...new Set(toUnlink.map((link) => link.clippingId)),
              ]),
              inArray(clippingTags.tagId, [...removeIds]),
            ),
          );
      }
      if (changedIds.length > 0) {
        await tx
          .update(clippings)
          .set({ updatedAt: clock.now() })
          .where(and(eq(clippings.userId, userId), inArray(clippings.id, changedIds)));
      }
      return { changed: changedIds.length, notFound };
    });
  }

  /**
   * One of the user's clippings, or null when they have no such clipping. The detail read: it
   * also carries the tag suggestions the user hasn't dismissed, while they have suggestions on.
   */
  async function getClipping(userId: string, clippingId: string): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const [row] = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
    if (!row) return null;
    const clipping = await oneWithTags(userId, row);
    const suggested = await db
      .select({ name: clippingTagSuggestions.name })
      .from(clippingTagSuggestions)
      .where(
        and(
          eq(clippingTagSuggestions.clippingId, clippingId),
          eq(clippingTagSuggestions.userId, userId),
          isNull(clippingTagSuggestions.dismissedAt),
          suggestionsOn(userId),
          notTaggedAs(clippingId, userId, clippingTagSuggestions.name),
        ),
      )
      .orderBy(clippingTagSuggestions.origin, tagKey(clippingTagSuggestions.name));
    return { ...clipping, suggestedTags: suggested.map((suggestion) => suggestion.name) };
  }

  /** Whether the user has tag suggestions on. */
  const suggestionsOn = (userId: string) =>
    sql`exists (select 1 from ${userSettings} where ${userSettings.userId} = ${userId} and ${userSettings.suggestTags})`;

  /** The clipping doesn't carry a tag of this name, ignoring case. */
  const notTaggedAs = (clippingId: string, userId: string, name: SQLWrapper) =>
    sql`not exists (
      select 1 from ${clippingTags} inner join ${tags} on ${tags.id} = ${clippingTags.tagId}
      where ${clippingTags.clippingId} = ${clippingId} and ${clippingTags.userId} = ${userId}
        and ${tagKey(tags.name)} = ${tagKey(name)}
    )`;

  /**
   * Pins the clipping above the newest-first list, or takes it down again. Pinning a pinned
   * clipping keeps its place. Returns it as it now stands, or null when the user has no such
   * clipping.
   */
  async function setPinned(
    userId: string,
    clippingId: string,
    pinned: boolean,
  ): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const now = clock.now();
    const [row] = await db
      .update(clippings)
      .set({
        pinnedAt: pinned
          ? sql`coalesce(${clippings.pinnedAt}, ${formatIsoUtc(now)}::timestamptz)`
          : null,
        updatedAt: now,
      })
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live))
      .returning(clippingColumns);
    return row ? oneWithTags(userId, row) : null;
  }

  /**
   * Adds a suggested tag to the clipping and removes the suggestion. The name matches one of the
   * user's tags ignoring case, so accepting "CSS" files it under "css". A name that isn't a
   * suggestion any more (dismissed, replaced by a re-read) changes nothing. Returns the clipping
   * as the detail read has it, or null when the user has no such clipping. Throws
   * `InvalidTagsError` when the clipping would have too many tags.
   */
  async function acceptTagSuggestion(
    userId: string,
    clippingId: string,
    name: string,
  ): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const accepted = await db.transaction(async (tx) => {
      // Locked, so a concurrent edit of the tags can't be lost under the replace below. `no key
      // update` still excludes other lockers like this one, but not the key-share lock a tag
      // link takes for its foreign key, which would deadlock against a concurrent tag merge.
      const [row] = await tx
        .select({ id: clippings.id })
        .from(clippings)
        .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live))
        .for("no key update");
      if (!row) return false;
      const suggestion = and(
        eq(clippingTagSuggestions.clippingId, clippingId),
        eq(clippingTagSuggestions.userId, userId),
        isNull(clippingTagSuggestions.dismissedAt),
        sql`${tagKey(clippingTagSuggestions.name)} = lower(${normalizeTagName(name)})`,
      );
      const [found] = await tx
        .select({ name: clippingTagSuggestions.name })
        .from(clippingTagSuggestions)
        .where(suggestion);
      if (found) {
        const current = await tx
          .select({ name: tags.name })
          .from(clippingTags)
          .innerJoin(tags, eq(tags.id, clippingTags.tagId))
          .where(and(eq(clippingTags.clippingId, clippingId), eq(clippingTags.userId, userId)));
        await setTags(
          tx,
          userId,
          clippingId,
          checkedTagNames([...current.map((tag) => tag.name), found.name]),
        );
        await tx.delete(clippingTagSuggestions).where(suggestion);
      }
      return true;
    });
    return accepted ? getClipping(userId, clippingId) : null;
  }

  /**
   * Dismisses the named suggestions, or all of the clipping's when `names` is left out. A
   * dismissed name is never suggested for that clipping again. Returns false when the user has no
   * such clipping.
   */
  async function dismissTagSuggestions(
    userId: string,
    clippingId: string,
    names?: readonly string[],
  ): Promise<boolean> {
    if (!UUID.test(clippingId)) return false;
    const [owned] = await db
      .select({ id: clippings.id })
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
    if (!owned) return false;
    const named = names === undefined ? [] : normalizeTagNames(names);
    if (names !== undefined && named.length === 0) return true;
    await db
      .update(clippingTagSuggestions)
      .set({ dismissedAt: clock.now() })
      .where(
        and(
          eq(clippingTagSuggestions.clippingId, clippingId),
          eq(clippingTagSuggestions.userId, userId),
          isNull(clippingTagSuggestions.dismissedAt),
          names === undefined
            ? undefined
            : sql`${tagKey(clippingTagSuggestions.name)} in ${keysOf(named)}`,
        ),
      );
    return true;
  }

  /**
   * Whether the user has a live clipping of the page at `url`, matched as saving it would match
   * it (by its normalized address). False for an address that isn't a web page.
   */
  async function hasClippingOfUrl(userId: string, url: string): Promise<boolean> {
    const parsed = parseWebUrl(url);
    if (!parsed) return false;
    const rows = await db
      .select({ id: clippings.id })
      .from(clippings)
      .where(
        and(eq(clippings.userId, userId), eq(clippings.urlNormalized, parsed.normalized), live),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Hides the clipping from every read until `restoreClipping` brings it back, so a delete can be
   * undone. Returns false when the user has no such clipping, or it is already deleted.
   */
  async function deleteClipping(userId: string, clippingId: string): Promise<boolean> {
    if (!UUID.test(clippingId)) return false;
    const now = clock.now();
    const deleted = await db
      .update(clippings)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live))
      .returning({ id: clippings.id });
    return deleted.length > 0;
  }

  /** Undoes `deleteClipping`. Returns false when the user has no such deleted clipping. */
  async function restoreClipping(userId: string, clippingId: string): Promise<boolean> {
    if (!UUID.test(clippingId)) return false;
    const restored = await db
      .update(clippings)
      .set({ deletedAt: null, updatedAt: clock.now() })
      .where(
        and(
          eq(clippings.id, clippingId),
          eq(clippings.userId, userId),
          isNotNull(clippings.deletedAt),
        ),
      )
      .returning({ id: clippings.id });
    return restored.length > 0;
  }

  /** The user's most-used tag names, up to `USER_TAGS_FOR_SUGGESTIONS`, for the model to reuse. */
  async function mostUsedTagNames(userId: string): Promise<string[]> {
    const uses = sql<number>`count(${clippings.id})`;
    const rows = await db
      .select({ name: tags.name })
      .from(tags)
      .leftJoin(clippingTags, eq(clippingTags.tagId, tags.id))
      .leftJoin(clippings, and(eq(clippings.id, clippingTags.clippingId), live))
      .where(eq(tags.userId, userId))
      .groupBy(tags.id)
      .orderBy(desc(uses), tagKey(tags.name), tags.name)
      .limit(USER_TAGS_FOR_SUGGESTIONS);
    return rows.map((row) => row.name);
  }

  /**
   * The tags that at least `NEIGHBOUR_VOTES_NEEDED` of the user's `NEIGHBOURS_VOTING` clippings
   * nearest in meaning to `vector` (within the "close in meaning" cutoff) carry, most shared
   * first, in the user's spelling.
   */
  async function neighbourTags(
    userId: string,
    clippingId: string,
    vector: number[],
  ): Promise<string[]> {
    const distance = cosineDistance(embedding, vector);
    const nearest = db.$with("nearest").as(
      db
        .select({ id: clippings.id })
        .from(clippings)
        .where(
          and(
            eq(clippings.userId, userId),
            live,
            ne(clippings.id, clippingId),
            closeInMeaning(distance),
          ),
        )
        .orderBy(asc(distance), desc(clippings.createdAt), desc(clippings.id))
        .limit(NEIGHBOURS_VOTING),
    );
    const votes = sql<number>`count(*)`;
    const rows = await db
      .with(nearest)
      .select({ name: tags.name })
      .from(clippingTags)
      .innerJoin(nearest, eq(nearest.id, clippingTags.clippingId))
      .innerJoin(tags, eq(tags.id, clippingTags.tagId))
      .where(eq(clippingTags.userId, userId))
      .groupBy(tags.id)
      .having(sql`${votes} >= ${NEIGHBOUR_VOTES_NEEDED}`)
      .orderBy(desc(votes), tagKey(tags.name))
      .limit(NEIGHBOUR_SUGGESTION_LIMIT);
    return rows.map((row) => row.name);
  }

  /**
   * Replaces the clipping's undismissed suggestions with these. A model reply that said nothing
   * about tags (`model` undefined) leaves the undismissed model suggestions as they were. Names
   * the clipping already carries, and names the user dismissed before, are not stored. Never
   * touches `clipping_tags`.
   */
  async function replaceSuggestions(
    tx: Transaction,
    userId: string,
    clippingId: string,
    { model, neighbours }: { model: readonly string[] | undefined; neighbours: readonly string[] },
    at: Date,
  ) {
    await tx
      .delete(clippingTagSuggestions)
      .where(
        and(
          eq(clippingTagSuggestions.clippingId, clippingId),
          eq(clippingTagSuggestions.userId, userId),
          isNull(clippingTagSuggestions.dismissedAt),
          model === undefined ? eq(clippingTagSuggestions.origin, "neighbours") : undefined,
        ),
      );
    const wanted = [
      ...normalizeTagNames(model ?? []).map((name) => ({ name, origin: "model" })),
      ...normalizeTagNames(neighbours).map((name) => ({ name, origin: "neighbours" })),
    ].filter(({ name }) => name.length <= MAX_TAG_LENGTH);
    if (wanted.length === 0) return;
    // A name in both lists is stored once, as the model's: it comes first, and the unique index
    // skips the second.
    await tx.execute(sql`
      insert into ${clippingTagSuggestions} (clipping_id, user_id, name, origin, created_at)
      select ${clippingId}::uuid, ${userId}, wanted.name, wanted.origin, ${formatIsoUtc(at)}::timestamptz
      from unnest(${sql.param(wanted.map((w) => w.name))}::text[], ${sql.param(wanted.map((w) => w.origin))}::text[])
        with ordinality as wanted(name, origin, position)
      where ${notTaggedAs(clippingId, userId, sql`wanted.name`)}
      order by wanted.position
      on conflict do nothing`);
  }

  /**
   * Keeps the page text of a clipping the reading just made ready: replaces the saved one, or
   * removes it when the page had none (a stale text must not outlive a re-read).
   */
  async function replacePageText(
    tx: Transaction,
    userId: string,
    clippingId: string,
    text: string,
    at: Date,
  ): Promise<void> {
    if (text === "") {
      await tx
        .delete(clippingTexts)
        .where(and(eq(clippingTexts.clippingId, clippingId), eq(clippingTexts.userId, userId)));
      return;
    }
    await tx
      .insert(clippingTexts)
      .values({ clippingId, userId, text, fetchedAt: at })
      .onConflictDoUpdate({ target: clippingTexts.clippingId, set: { text, fetchedAt: at } });
  }

  /**
   * Reads a pending clipping's page and fills in its title, summary and excerpt. Safe to repeat:
   * only a pending clipping is touched, so a redelivered job does nothing, and the user's title,
   * note and tags are never written. For a user with tag suggestions on, it also stores the tags
   * it suggests (see `replaceSuggestions`), in the transaction that makes the clipping ready.
   */
  async function enrichClipping(
    clippingId: string,
    { lastAttempt = false }: EnrichClippingOptions = {},
  ): Promise<EnrichmentOutcome> {
    if (!UUID.test(clippingId)) return "skipped";
    const [row] = await db
      .select(clippingColumns)
      .from(clippings)
      .where(eq(clippings.id, clippingId));
    if (!row || row.status !== "pending") return "skipped";

    // Only a user with suggestions on has their tag names sent to the model.
    const [settings] = await db
      .select({ on: userSettings.suggestTags })
      .from(userSettings)
      .where(eq(userSettings.userId, row.userId));
    const suggesting = settings?.on === true;
    const userTags = suggesting ? await mostUsedTagNames(row.userId) : undefined;

    let read: PageSummary;
    let pageText = "";
    let meaning: number[] | null = null;
    try {
      const page = await fetcher.fetchPage(row.url);
      pageText = page.text;
      read = await summarizer.summarize({
        url: row.url,
        ...page,
        ...(userTags === undefined ? {} : { userTags }),
      });
      // The reading stands without an embedding: search finds the clipping by its words, and the
      // daily sweep embeds it later. A retry would only read the page and call Haiku again.
      meaning = await embed(documentText(read), "document").catch((error: unknown) => {
        console.error(`Couldn't embed clipping ${clippingId}; saving it without`, error);
        return null;
      });
    } catch (error) {
      if (!lastAttempt) throw error;
      const now = clock.now();
      await db
        .update(clippings)
        .set(statusChange("failed", now))
        .where(and(eq(clippings.id, clippingId), eq(clippings.status, "pending")));
      return "failed";
    }

    // The vote is a bonus: without it the reading and the model's suggestions still stand.
    const neighbours =
      suggesting && meaning
        ? await neighbourTags(row.userId, clippingId, meaning).catch((error: unknown) => {
            console.error(`Couldn't count neighbour tags for clipping ${clippingId}`, error);
            return [];
          })
        : [];

    const now = clock.now();
    const updated = await db.transaction(async (tx) => {
      const [ready] = await tx
        .update(clippings)
        .set({
          // Never `user_title`: a rename is the user's.
          title: read.title,
          summary: read.summary,
          excerpt: read.excerpt,
          embedding: meaning,
          // The fetch just got a 2xx: the link is alive as of now.
          linkCheckedAt: now,
          linkFailures: 0,
          linkDeadSince: null,
          ...statusChange("ready", now),
        })
        .where(and(eq(clippings.id, clippingId), eq(clippings.status, "pending")))
        .returning({ id: clippings.id });
      if (ready) await replacePageText(tx, row.userId, clippingId, pageText, now);
      if (ready && suggesting) {
        await replaceSuggestions(
          tx,
          row.userId,
          clippingId,
          { model: read.suggestedTags, neighbours },
          now,
        );
      }
      return ready;
    });
    return updated ? "ready" : "skipped";
  }

  /**
   * Reads the page again: a ready or failed clipping goes back to pending and the job is
   * requested. Its title, note and tags stay the user's. Returns the clipping as it stands
   * (unchanged when it was already pending), or null when the user has no such clipping.
   */
  async function reEnrichClipping(userId: string, clippingId: string): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const [current] = await db
      .select({ status: clippings.status })
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
    if (!current) return null;
    if (current.status === "pending") return getClipping(userId, clippingId);

    const [restarted] = await db
      .update(clippings)
      .set(statusChange("pending", clock.now()))
      .where(
        and(
          eq(clippings.id, clippingId),
          eq(clippings.userId, userId),
          eq(clippings.status, current.status),
          live,
        ),
      )
      .returning(clippingColumns);
    if (!restarted) return getClipping(userId, clippingId);

    try {
      await jobs.requestEnrichment(restarted.id);
    } catch (error) {
      // Don't leave it pending with no job behind it, and let the caller see the failure. The
      // restart above stamped the status time, so the sweep counts from there.
      await db
        .update(clippings)
        .set({ status: current.status })
        .where(and(eq(clippings.id, restarted.id), eq(clippings.status, "pending")));
      throw error;
    }
    return oneWithTags(userId, restarted);
  }

  /**
   * For the daily cron: requests enrichment again for clippings that have been pending or failed
   * for more than an hour, starting failed ones over. Returns the ids it requested. A batch is
   * capped, so a backlog drains over several days instead of one long run. Imports waiting their
   * turn are pending on purpose: `drainImports` takes those.
   */
  async function sweepStuck(): Promise<string[]> {
    const now = clock.now();
    const stuckBefore = subHours(now, STUCK_AFTER_HOURS);
    const stuck = db
      .select({ id: clippings.id })
      .from(clippings)
      .where(
        and(
          inArray(clippings.status, ["pending", "failed"]),
          lt(clippings.statusChangedAt, stuckBefore),
          or(ne(clippings.source, "import"), ne(clippings.status, "pending")),
          live,
        ),
      )
      .limit(SWEEP_BATCH_SIZE);
    const restarted = await db
      .update(clippings)
      .set(statusChange("pending", now))
      .where(inArray(clippings.id, stuck))
      .returning({ id: clippings.id });

    const ids = restarted.map((row) => row.id);
    const results = await Promise.allSettled(ids.map((id) => jobs.requestEnrichment(id)));
    for (const result of results) {
      if (result.status === "rejected") console.error("Couldn't request enrichment", result.reason);
    }
    return ids;
  }

  /**
   * For the daily cron: requests enrichment of the oldest pending imports, at most
   * `IMPORT_DAILY_BUDGET` a day, spread over `IMPORT_SPREAD_SECONDS`. Returns the ids it
   * requested. Imports are made pending without a job, so this is how they get read.
   *
   * It claims the batch in one statement that stamps `import_requested_at` and the status time, so
   * two overlapping runs never take the same clipping. The budget counts what was requested in
   * the last `IMPORT_SPREAD_SECONDS`, so a second run the same day takes only the remainder; a
   * lock keeps two runs from both counting before either claims. A clipping whose job is lost
   * (still pending a spread window later) is taken again, behind the others. Throws when the
   * queue can't be reached, after giving the budget back.
   */
  async function drainImports(): Promise<string[]> {
    const now = clock.now();
    const windowStart = subSeconds(now, IMPORT_SPREAD_SECONDS);

    const claimed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('clippings.drainImports'))`);
      const [spent] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(clippings)
        .where(and(eq(clippings.source, "import"), gte(clippings.importRequestedAt, windowStart)));
      const remaining = IMPORT_DAILY_BUDGET - (spent?.count ?? 0);
      if (remaining <= 0) return [];

      // A CTE with row locks is evaluated once, so the update gets exactly the rows it locked.
      const next = tx.$with("next").as(
        tx
          .select({ id: clippings.id, waitingSince: clippings.statusChangedAt })
          .from(clippings)
          .where(
            and(
              eq(clippings.source, "import"),
              eq(clippings.status, "pending"),
              or(isNull(clippings.importRequestedAt), lt(clippings.importRequestedAt, windowStart)),
              live,
            ),
          )
          .orderBy(asc(clippings.statusChangedAt), asc(clippings.createdAt), asc(clippings.id))
          .limit(remaining)
          .for("update", { skipLocked: true }),
      );
      return tx
        .with(next)
        .update(clippings)
        .set({ importRequestedAt: now, statusChangedAt: now })
        .from(next)
        .where(eq(clippings.id, next.id))
        .returning({
          id: clippings.id,
          createdAt: clippings.createdAt,
          waitingSince: next.waitingSince,
        });
    });
    if (claimed.length === 0) return [];

    // In the order picked, so the import that has waited longest, then the oldest bookmark, gets
    // the earliest slot.
    const ids = claimed
      .toSorted(
        (a, b) =>
          a.waitingSince.getTime() - b.waitingSince.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row) => row.id);
    try {
      await jobs.requestEnrichments(ids, { spreadOverSeconds: IMPORT_SPREAD_SECONDS });
    } catch (error) {
      // Nothing was requested, so don't spend the budget on it: the next run takes them again.
      await db.update(clippings).set({ importRequestedAt: null }).where(inArray(clippings.id, ids));
      throw error;
    }
    return ids;
  }

  /** How many of the user's imported clippings still wait to be read. */
  async function countPendingImports(userId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          eq(clippings.source, "import"),
          eq(clippings.status, "pending"),
          live,
        ),
      );
    return row?.count ?? 0;
  }

  /** The bookmarks as pages to save: the ones that aren't web pages counted, the rest once each. */
  function toImportPages(items: readonly ImportItem[], foldersAsTags: boolean, now: Date) {
    let skipped = 0;
    const pages = new Map<
      string,
      { url: string; normalized: string; createdAt: Date; folders: string[] }
    >();
    for (const item of items) {
      const parsed = parseWebUrl(item.url);
      if (!parsed) {
        skipped += 1;
        continue;
      }
      const saved =
        item.addedAt &&
        isValid(item.addedAt) &&
        !isAfter(item.addedAt, now) &&
        !isBefore(item.addedAt, EARLIEST_BOOKMARK)
          ? item.addedAt
          : now;
      const folders = foldersAsTags
        ? normalizeTagNames(item.folders).filter((name) => name.length <= MAX_TAG_LENGTH)
        : [];
      const seen = pages.get(parsed.normalized);
      if (!seen) {
        pages.set(parsed.normalized, {
          url: parsed.url,
          normalized: parsed.normalized,
          createdAt: saved,
          folders,
        });
      } else {
        // The same page twice in one file is one clipping, in both folders, as old as either.
        if (isBefore(saved, seen.createdAt)) seen.createdAt = saved;
        seen.folders = normalizeTagNames([...seen.folders, ...folders]);
      }
    }
    for (const page of pages.values()) page.folders = page.folders.slice(0, MAX_TAGS_PER_CLIPPING);
    return { skipped, pages: [...pages.values()] };
  }

  /**
   * What `importClippings` would do with these bookmarks, without writing anything: the same
   * URL rules and duplicate detection as saving.
   */
  async function previewImport(
    userId: string,
    items: readonly ImportItem[],
  ): Promise<ImportCounts> {
    const { skipped, pages } = toImportPages(items, false, clock.now());
    if (pages.length === 0) return { created: 0, existing: 0, skipped };
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          inArray(
            clippings.urlNormalized,
            pages.map((page) => page.normalized),
          ),
          live,
        ),
      );
    const existing = row?.count ?? 0;
    return { created: pages.length - existing, existing, skipped };
  }

  /**
   * Saves bookmarks as clippings in one transaction, so a failure imports none. Each page goes
   * through the same normalisation and duplicate detection as `saveClipping`: a page the user
   * already has is left alone, a deleted clipping of it starts over, and a page that appears
   * twice in the file counts once. New clippings are pending, titled by their URL, from source
   * `import`, dated as the bookmark was saved (now when that date is missing, in the future or
   * before 1990). With `foldersAsTags`, a bookmark's folders become its tags. No job is
   * published: `drainImports` requests them gradually.
   */
  async function importClippings(
    userId: string,
    items: readonly ImportItem[],
    { foldersAsTags }: ImportOptions,
  ): Promise<ImportCounts> {
    const now = clock.now();
    const { skipped, pages } = toImportPages(items, foldersAsTags, now);
    if (pages.length === 0) return { created: 0, existing: 0, skipped };

    const written = await db.transaction(async (tx) => {
      const rows: { id: string; urlNormalized: string }[] = [];
      for (const chunk of chunks(pages, IMPORT_CHUNK_SIZE)) {
        rows.push(
          ...(await tx
            .insert(clippings)
            .values(
              chunk.map((page) => ({
                userId,
                url: page.url,
                urlNormalized: page.normalized,
                title: page.url,
                source: "import" as const,
                createdAt: page.createdAt,
                ...statusChange("pending", now),
              })),
            )
            // A deleted clipping of the same page starts over, as saving it again would.
            .onConflictDoUpdate({
              target: [clippings.userId, clippings.urlNormalized],
              set: {
                url: sql`excluded.url`,
                title: sql`excluded.title`,
                userTitle: null,
                pinnedAt: null,
                note: "",
                summary: null,
                excerpt: null,
                source: "import",
                clientId: null,
                deletedAt: null,
                createdAt: sql`excluded.created_at`,
                status: "pending",
                statusChangedAt: now,
                importRequestedAt: null,
                ...noLinkVerdict,
                updatedAt: now,
              },
              setWhere: isNotNull(clippings.deletedAt),
            })
            .returning({ id: clippings.id, urlNormalized: clippings.urlNormalized })),
        );
      }
      if (rows.length === 0) return rows;

      const ids = rows.map((row) => row.id);
      // Revived clippings start over without tags, suggestions or page text; new ones have none to delete.
      for (const chunk of chunks(ids, 5000)) {
        await tx
          .delete(clippingTags)
          .where(and(eq(clippingTags.userId, userId), inArray(clippingTags.clippingId, chunk)));
        await tx
          .delete(clippingTagSuggestions)
          .where(
            and(
              eq(clippingTagSuggestions.userId, userId),
              inArray(clippingTagSuggestions.clippingId, chunk),
            ),
          );
        await tx
          .delete(clippingTexts)
          .where(and(eq(clippingTexts.userId, userId), inArray(clippingTexts.clippingId, chunk)));
      }
      if (foldersAsTags) await tagImported(tx, userId, rows, pages, now);
      return rows;
    });

    return {
      created: written.length,
      existing: pages.length - written.length,
      skipped,
    };
  }

  /** Links the imported clippings to their folders' tags, creating the tags the user lacks. */
  async function tagImported(
    tx: Transaction,
    userId: string,
    rows: readonly { id: string; urlNormalized: string }[],
    pages: readonly { normalized: string; folders: readonly string[] }[],
    createdAt: Date,
  ) {
    const foldersOf = new Map(pages.map((page) => [page.normalized, page.folders]));
    const names = normalizeTagNames(rows.flatMap((row) => foldersOf.get(row.urlNormalized) ?? []));
    if (names.length === 0) return;
    for (const chunk of chunks(names.toSorted(), IMPORT_CHUNK_SIZE)) {
      // Sorted, like `setTags`, so two imports creating the same tags can't deadlock.
      await tx
        .insert(tags)
        .values(chunk.map((name) => ({ userId, name, createdAt })))
        .onConflictDoNothing();
    }
    // Which tag each name is, by Postgres's `lower`, as the unique index has it.
    const resolved = await tx.execute<{ name: string; id: string }>(sql`
      select names.name, ${tags.id} as id
      from unnest(${sql.param(names)}::text[]) as names(name)
      inner join ${tags} on ${tags.userId} = ${userId} and ${tagKey(tags.name)} = ${tagKey(sql`names.name`)}`);
    const tagIdOf = new Map(resolved.rows.map((tag) => [tagNameKey(tag.name), tag.id]));
    const links: { clippingId: string; tagId: string; userId: string }[] = [];
    for (const row of rows) {
      const tagIds = new Set(
        (foldersOf.get(row.urlNormalized) ?? []).flatMap((name) => {
          const id = tagIdOf.get(tagNameKey(name));
          return id ? [id] : [];
        }),
      );
      for (const tagId of tagIds) links.push({ clippingId: row.id, tagId, userId });
    }
    for (const chunk of chunks(links, 2000)) {
      await tx.insert(clippingTags).values(chunk).onConflictDoNothing();
    }
  }

  /**
   * For the daily cron: embeds ready clippings that have no embedding (saved before search by
   * meaning, or when the embedder was down), and returns how many. A batch is capped like the
   * sweep's, and stops at the first failure, which is most likely the provider being down.
   */
  async function embedMissing(): Promise<number> {
    const missing = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.status, "ready"), isNull(embedding), live))
      .orderBy(desc(clippings.createdAt))
      .limit(EMBED_BATCH_SIZE);
    let count = 0;
    for (const row of missing) {
      let vector: number[];
      try {
        vector = await embed(documentText(row), "document");
      } catch (error) {
        console.error(`Couldn't embed clipping ${row.id}; stopping for today`, error);
        break;
      }
      // Only while still missing: enrichment may have written one in the meantime.
      const [updated] = await db
        .update(clippings)
        .set({ embedding: vector })
        .where(and(eq(clippings.id, row.id), isNull(embedding)))
        .returning({ id: clippings.id });
      if (updated) count += 1;
    }
    return count;
  }

  /**
   * For the daily cron: removes for good the clippings deleted more than a day ago, and returns how
   * many. A batch is capped like the sweep's, so a backlog drains over several days.
   */
  async function purgeDeleted(): Promise<number> {
    const deletedBefore = subHours(clock.now(), PURGE_AFTER_HOURS);
    const expired = and(isNotNull(clippings.deletedAt), lt(clippings.deletedAt, deletedBefore));
    const batch = db
      .select({ id: clippings.id })
      .from(clippings)
      .where(expired)
      .limit(PURGE_BATCH_SIZE);
    // `expired` again on the delete itself: a save of the same URL may revive a row in between.
    const purged = await db
      .delete(clippings)
      .where(and(inArray(clippings.id, batch), expired))
      .returning({ id: clippings.id });
    return purged.length;
  }

  /**
   * For the daily cron: checks up to `limit` ready clippings whose link was last checked more
   * than a week ago or never, the longest-unchecked first, and returns how many it checked and
   * how many of those answered dead this time. A live answer clears the failures; a dead one
   * counts one, and the third in a row marks the clipping dead since that check (kept through
   * further failures); an unknown one (the site refuses robots, say) only stamps the check. Each
   * result is written as it arrives, so a run cut short loses only the links still in flight.
   *
   * A write goes through only while the row is still the one that was checked: ready, live, at
   * the same url and with the same last check. A clipping deleted and saved again meanwhile, or
   * checked by an overlapping run, is left alone, and isn't counted.
   */
  async function checkLinks({
    limit,
  }: {
    limit: number;
  }): Promise<{ checked: number; dead: number }> {
    const now = clock.now();
    const due = await db
      .select({ id: clippings.id, url: clippings.url, checkedAt: clippings.linkCheckedAt })
      .from(clippings)
      .where(
        and(
          eq(clippings.status, "ready"),
          live,
          or(
            isNull(clippings.linkCheckedAt),
            lt(clippings.linkCheckedAt, subDays(now, LINK_RECHECK_AFTER_DAYS)),
          ),
        ),
      )
      .orderBy(sql`${clippings.linkCheckedAt} asc nulls first`, asc(clippings.id))
      .limit(limit);

    let next = 0;
    let checked = 0;
    let dead = 0;
    async function worker() {
      while (next < due.length) {
        const { id, url, checkedAt } = due[next++]!;
        const verdict = await fetcher.checkLink(url);
        const update = db
          .update(clippings)
          .set(
            verdict === "alive"
              ? { linkCheckedAt: now, linkFailures: 0, linkDeadSince: null }
              : verdict === "unknown"
                ? { linkCheckedAt: now }
                : {
                    linkCheckedAt: now,
                    // The columns on the right are the values before this update.
                    linkFailures: sql`${clippings.linkFailures} + 1`,
                    linkDeadSince: sql`case when ${clippings.linkFailures} + 1 >= ${LINK_DEAD_AFTER_FAILURES} then coalesce(${clippings.linkDeadSince}, ${now}) else ${clippings.linkDeadSince} end`,
                  },
          )
          .where(
            and(
              eq(clippings.id, id),
              eq(clippings.status, "ready"),
              live,
              eq(clippings.url, url),
              checkedAt === null
                ? isNull(clippings.linkCheckedAt)
                : eq(clippings.linkCheckedAt, checkedAt),
            ),
          );
        const [written] = await update.returning({ id: clippings.id });
        if (!written) continue;
        checked += 1;
        if (verdict === "dead") dead += 1;
      }
    }
    await Promise.all(Array.from({ length: LINK_CHECK_CONCURRENCY }, worker));
    return { checked, dead };
  }

  return {
    saveClipping,
    listTags,
    listTagSummaries,
    findTagByName,
    renameTag,
    mergeTag,
    deleteTag,
    setTagColor,
    listClippings,
    listSavedClippings,
    searchClippings,
    relatedClippings,
    exportClippings,
    getClippingText,
    updateClipping,
    tagClippings,
    getClipping,
    hasClippingOfUrl,
    deleteClipping,
    restoreClipping,
    enrichClipping,
    reEnrichClipping,
    setPinned,
    acceptTagSuggestion,
    dismissTagSuggestions,
    previewImport,
    importClippings,
    countPendingImports,
    drainImports,
    sweepStuck,
    embedMissing,
    purgeDeleted,
    checkLinks,
  };
}

export type ClippingsService = ReturnType<typeof createClippingsService>;
