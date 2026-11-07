import { redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { LessonsEmptyState } from "@/components/lessons/empty-state.tsx";
import { LessonList } from "@/components/lessons/lesson-list.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { getLessons } from "@/lib/lessons/store.ts";
import type { Lesson } from "@clippings/shared";

/** How many lessons the page lists: two a week, so this is more than a year. */
const LESSON_LIMIT = 120;

async function Lessons() {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());

  let lessons: Lesson[];
  try {
    lessons = await getLessons().listLessons(session.user.id, { limit: LESSON_LIMIT });
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load your lessons." />;
  }

  return lessons.length === 0 ? <LessonsEmptyState /> : <LessonList lessons={lessons} />;
}

export default function LessonsPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-220">
        <PageHeader title="Lessons" eyebrow="Written from your library" />
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <Lessons />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
