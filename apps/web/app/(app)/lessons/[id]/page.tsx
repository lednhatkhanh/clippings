import { constructNow } from "date-fns";
import { ChevronLeft, Link2, StickyNote } from "lucide-react";
import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { AiWritten } from "@/components/ai-written.tsx";
import { ListSkeleton } from "@/components/clippings/list-skeleton.tsx";
import { formatLessonDay } from "@/components/lessons/format-day.ts";
import { LessonQuizQuestion } from "@/components/lessons/quiz.tsx";
import { LoadError } from "@/components/load-error.tsx";
import { Markdown } from "@/components/markdown.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import {
  PageTransition,
  RevealTransition,
  SkeletonTransition,
} from "@/components/page-transition.tsx";
import { getSession, signInRedirect } from "@/lib/auth/session.ts";
import { getLessons } from "@/lib/lessons/store.ts";
import type { Lesson, LessonSourceItem } from "@clippings/shared";
import { LinkButton } from "@clippings/ui";

const SECTION = "flex flex-col gap-4 rounded-xl paper p-5 medium:p-6";

/** The clippings and notes the lesson drew on, each a link to it. */
function DrawnFrom({ sources }: { sources: readonly LessonSourceItem[] }) {
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby="drawn-from-heading" className={SECTION}>
      <h2 id="drawn-from-heading" className="typescale-title-lg">
        Drawn from
      </h2>
      <ul className="flex flex-col gap-2.5">
        {sources.map((source) => (
          <li key={source.id}>
            <Link
              href={`/c/${source.id}`}
              className="flex lift items-start gap-3 rounded-md paper px-3.5 py-3"
            >
              <span aria-hidden="true" className="pt-0.5 text-ink-muted">
                {source.kind === "note" ? (
                  <StickyNote className="size-5" />
                ) : (
                  <Link2 className="size-5" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-row-gap">
                <span className="typescale-clipping-title text-pretty wrap-anywhere">
                  {source.title}
                </span>
                <span className="typescale-label-sm text-ink-faint">
                  {source.kind === "note" ? "Note" : "Link"}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A lesson that isn't ready: where it stands, and for a skipped one why. */
function Unfinished({ lesson }: { lesson: Lesson }) {
  return (
    <section className={SECTION}>
      <header className="flex flex-col gap-2">
        <h2 className="typescale-headline-sm">
          {lesson.status === "writing" ? "Being written now" : "Skipped"}
        </h2>
        <p className="typescale-label-md text-ink-faint">
          <time dateTime={lesson.day}>{formatLessonDay(lesson.day)}</time>
        </p>
      </header>
      <p className="typescale-body-md text-pretty text-ink-muted">
        {lesson.status === "writing"
          ? "This lesson is still being written. Check back in a few minutes."
          : (lesson.skipReason ?? "No reason was recorded.")}
      </p>
    </section>
  );
}

async function LessonDetail({ params }: Pick<PageProps<"/lessons/[id]">, "params">) {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  const { id } = await params;

  let lesson: Lesson | null;
  try {
    lesson = await getLessons().getLesson(session.user.id, id);
  } catch (error) {
    unstable_rethrow(error);
    return <LoadError message="Couldn't load this lesson." />;
  }
  if (!lesson) notFound();
  if (lesson.status !== "ready" || lesson.body === null) return <Unfinished lesson={lesson} />;

  const { topic, body, quiz, recap, sources, day, updatedAt } = lesson;

  return (
    <div className="flex flex-col gap-4">
      <article className={SECTION}>
        <header className="flex flex-col gap-2">
          <h2 className="typescale-headline-sm text-pretty wrap-anywhere">{topic}</h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 typescale-label-md text-ink-faint">
            <time dateTime={day}>{formatLessonDay(day)}</time>
            <span aria-hidden="true">·</span>
            <AiWritten updatedAt={updatedAt} now={constructNow(undefined)} />
          </p>
        </header>
        {recap ? (
          <section aria-labelledby="recap-heading" className="flex flex-col gap-2">
            <h3 id="recap-heading" className="typescale-title-md">
              Last time
            </h3>
            <Markdown source={recap} links="web" />
          </section>
        ) : null}
        <Markdown source={body} links="web" />
        <p className="typescale-body-sm text-ink-faint">
          A model wrote this lesson from your clippings and notes and may have it wrong. They are
          the source.
        </p>
      </article>

      {quiz ? (
        <section aria-labelledby="quiz-heading" className={SECTION}>
          <h2 id="quiz-heading" className="typescale-title-lg">
            Check yourself
          </h2>
          <LessonQuizQuestion quiz={quiz} />
        </section>
      ) : null}

      <DrawnFrom sources={sources} />
    </div>
  );
}

export default function LessonPage({ params }: PageProps<"/lessons/[id]">) {
  return (
    <PageTransition>
      <div className="mx-auto flex max-w-180 flex-col gap-4 pb-4">
        <PageHeader
          title="Lesson"
          eyebrow="Written from your library"
          start={
            <Link
              href="/lessons"
              transitionTypes={["nav-back"]}
              aria-label="Back to lessons"
              className="state-layer flex size-11 items-center justify-center rounded-md text-ink"
            >
              <ChevronLeft className="size-5" />
            </Link>
          }
        />
        <LinkButton
          href="/lessons"
          routerOptions={{ transitionTypes: ["nav-back"] }}
          className="hidden self-start medium:inline-flex"
        >
          <ChevronLeft className="size-4.5" />
          Lessons
        </LinkButton>
        <Suspense
          fallback={
            <SkeletonTransition>
              <ListSkeleton />
            </SkeletonTransition>
          }
        >
          <RevealTransition>
            <LessonDetail params={params} />
          </RevealTransition>
        </Suspense>
      </div>
    </PageTransition>
  );
}
