"use client";

import { debounce, useQueryStates } from "nuqs";
import { useEffect, useState } from "react";
import useSWR from "swr";

import {
  browseParsers,
  browseUrlKeys,
  toQueryString,
  type BrowseParams,
} from "@/lib/clippings/browse-params.ts";
import type { RowsPage } from "@/lib/clippings/rows.ts";
import { SOURCE_LABELS } from "@/lib/clippings/source-labels.ts";
import { CLIPPING_SOURCES, SEARCH_RESULT_LIMIT, SEARCH_SORTS } from "@clippings/shared";
import {
  Button,
  cn,
  FilterChip,
  FilterChips,
  SearchField,
  Segment,
  SegmentedButtons,
} from "@clippings/ui";

import { ClippingList } from "./clipping-list.tsx";
import { fetchRows } from "./fetch-row.ts";

/** How long typing pauses before the query is searched. */
const SEARCH_DEBOUNCE_MS = 200;

function NoResults({
  q,
  hasFilters,
  onClearFilters,
}: {
  q: string;
  hasFilters: boolean;
  onClearFilters: () => void;
}) {
  return (
    <section className="flex flex-col items-center gap-3 py-12 text-center">
      <h2 className="typescale-title-lg">
        {q ? <>No clippings match &ldquo;{q}&rdquo;</> : "No clippings from these sources"}
      </h2>
      <p className="max-w-100 typescale-body-md text-on-surface-variant">
        {q && hasFilters
          ? "Try fewer words, or search every source."
          : q
            ? "Try fewer or different words."
            : "Choose other sources, or show them all."}
      </p>
      {hasFilters ? (
        <Button variant="text" onPress={onClearFilters}>
          Clear filters
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The search field, source filters and the list they describe. The server renders the first
 * result for the URL's params; after that, typing searches through SWR, debounced, with the
 * previous results kept, dimmed, until the new ones arrive. The field and filters live in the URL
 * (nuqs, shallow): it follows along without a server request, so a reload shows the same results,
 * and a navigation that changes it (the Clippings link) changes them. These are plain state
 * updates, so no view transition runs while typing.
 */
export function ClippingsBrowser({
  initialParams,
  initialPage,
}: {
  initialParams: BrowseParams;
  initialPage: RowsPage;
}) {
  const [{ q: query, sources, sort }, setParams] = useQueryStates(browseParsers, {
    urlKeys: browseUrlKeys,
  });
  const [searchedQuery, setSearchedQuery] = useState(query);

  function changeQuery(value: string) {
    // The URL takes the query after the same pause as the search. Clearing is immediate and
    // drops the sort, which only orders search results.
    const typing = value.trim() !== "";
    void setParams(typing ? { q: value } : { q: null, sort: null }, {
      limitUrlUpdates: typing ? debounce(SEARCH_DEBOUNCE_MS) : undefined,
    });
  }

  // Typing waits for a pause; clearing the field shows the whole list at once.
  useEffect(() => {
    if (query === searchedQuery) return;
    const timer = setTimeout(() => setSearchedQuery(query), query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query, searchedQuery]);

  const params: BrowseParams = { q: searchedQuery, sources, sort };
  const key = toQueryString(params);
  // What the server rendered: it renders again, with fresh rows, after a save or delete.
  const isServerPage = key === toQueryString(initialParams);

  const { data, error, isLoading } = useSWR(
    isServerPage ? null : `/api/clippings?${key}`,
    fetchRows,
  );
  const current = isServerPage ? initialPage : isLoading ? undefined : data;

  // The rows on screen: the latest that arrived, kept while the next ones load.
  const [shown, setShown] = useState({ key, page: initialPage });
  if (current && current !== shown.page) setShown({ key, page: current });

  const isStale = !current || query.trim() !== searchedQuery.trim();
  const shownParams = new URLSearchParams(shown.key);
  const shownQuery = shownParams.get("q") ?? "";
  const hasFilters = sources.length > 0;
  const rows = shown.page.rows;

  return (
    <div className="flex flex-col gap-3">
      <SearchField
        aria-label="Search your clippings"
        placeholder="Search your clippings"
        value={query}
        onChange={changeQuery}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          aria-label="Sources"
          selectedKeys={sources}
          onSelectionChange={(keys) =>
            void setParams({ sources: CLIPPING_SOURCES.filter((source) => keys.includes(source)) })
          }
        >
          {CLIPPING_SOURCES.map((source) => (
            <FilterChip key={source} id={source}>
              {SOURCE_LABELS[source]}
            </FilterChip>
          ))}
        </FilterChips>
        {searchedQuery.trim() ? (
          <SegmentedButtons
            aria-label="Sort results"
            selectedKey={sort}
            onSelectionChange={(selected) =>
              void setParams({ sort: SEARCH_SORTS.find((option) => option === selected) ?? null })
            }
            className="w-64"
          >
            <Segment id="relevance">Best match</Segment>
            <Segment id="date">Newest</Segment>
          </SegmentedButtons>
        ) : null}
      </div>

      <output className="block min-h-5 typescale-label-md text-on-surface-variant">
        {error && !current
          ? "Couldn't search. Check your connection and keep typing to try again."
          : shownQuery && rows.length >= SEARCH_RESULT_LIMIT
            ? `The best ${SEARCH_RESULT_LIMIT} matches`
            : shownQuery && rows.length > 0
              ? `${rows.length === 1 ? "1 clipping" : `${rows.length} clippings`} match`
              : null}
      </output>

      <div
        aria-busy={isStale}
        className={cn("transition-opacity duration-150", isStale && "opacity-60")}
      >
        {rows.length === 0 ? (
          <NoResults
            q={shownQuery}
            hasFilters={hasFilters}
            onClearFilters={() => void setParams({ sources: null })}
          />
        ) : (
          <ClippingList
            key={`${shown.key}|${rows.map((row) => row.id).join()}`}
            query={shown.key}
            initialRows={rows}
            initialCursor={shown.page.nextCursor}
          />
        )}
      </div>
    </div>
  );
}
