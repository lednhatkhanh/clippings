import Link from "next/link";

import { AiWrittenBadge } from "@/components/ai-written.tsx";
import type { Lesson } from "@clippings/shared";

import { formatLessonDay } from "./format-day.ts";

const ROW = "flex flex-col gap-1.5 rounded-lg paper px-4 py-row-block";

function Day({ day }: { day: string }) {
  return (
    <time dateTime={day} className="typescale-label-md text-ink-faint">
      {formatLessonDay(day)}
    </time>
  );
}

/** One lesson: a link once it is ready, and where it stands otherwise. */
function LessonRow({ lesson }: { lesson: Lesson }) {
  if (lesson.status === "ready") {
    return (
      <Link href={`/lessons/${lesson.id}`} className={`${ROW} lift`}>
        <Day day={lesson.day} />
        <span className="typescale-clipping-title text-pretty wrap-anywhere">{lesson.topic}</span>
        <span className="flex">
          <AiWrittenBadge />
        </span>
      </Link>
    );
  }
  return (
    <div className={ROW}>
      <Day day={lesson.day} />
      {lesson.status === "writing" ? (
        <span className="typescale-body-md text-ink-muted">Being written now.</span>
      ) : (
        <>
          <span className="typescale-title-sm">Skipped</span>
          <span className="typescale-body-md text-pretty text-ink-muted">
            {lesson.skipReason ?? "No reason was recorded."}
          </span>
        </>
      )}
    </div>
  );
}

/** The user's lessons, newest first as the service gives them. */
export function LessonList({ lessons }: { lessons: readonly Lesson[] }) {
  return (
    <ul aria-label="Your lessons" className="flex flex-col gap-2.5">
      {lessons.map((lesson) => (
        <li key={lesson.id}>
          <LessonRow lesson={lesson} />
        </li>
      ))}
    </ul>
  );
}
