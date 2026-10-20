import { Suspense } from "react";

import { ClippingsHome } from "@/components/clippings/clippings-home.tsx";
import { OpenShare } from "@/components/clippings/open-share.tsx";
import { extractSharedUrl } from "@clippings/shared";

type SearchParams = PageProps<"/share">["searchParams"];

/** A repeated parameter counts by its first value. */
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Share({ searchParams }: { searchParams: SearchParams }) {
  const { url, text, title } = await searchParams;
  return (
    <OpenShare
      link={extractSharedUrl({ url: first(url), text: first(text), title: first(title) })}
    />
  );
}

/**
 * The manifest's share target: Android's share sheet opens it with `?title=&text=&url=`. It shows
 * the list with "New clipping" filled in; the share's parameters aren't the list's.
 */
export default function SharePage({ searchParams }: PageProps<"/share">) {
  return (
    <>
      <ClippingsHome searchParams={Promise.resolve({})} />
      <Suspense fallback={null}>
        <Share searchParams={searchParams} />
      </Suspense>
    </>
  );
}
