import { getGateway } from "@/lib/gateway/service.ts";

import { getLessons } from "./store.ts";
import { createLessonWriter, type LessonWriter } from "./writer.ts";

let writer: LessonWriter | undefined;

/** The lesson writer on the shared pool and the model gateway, for the twice-weekly job. */
export function getLessonWriter(): LessonWriter {
  return (writer ??= createLessonWriter({ lessons: getLessons(), gateway: getGateway() }));
}
