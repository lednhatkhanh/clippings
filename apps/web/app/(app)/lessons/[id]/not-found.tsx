import { StatusPage } from "@/components/status-page.tsx";
import { LinkButton } from "@clippings/ui";

/** A lesson that belongs to someone else or never existed: both look the same. */
export default function LessonNotFound() {
  return (
    <StatusPage
      title="This lesson isn't here."
      actions={
        <LinkButton
          variant="paper"
          href="/lessons"
          routerOptions={{ transitionTypes: ["nav-back"] }}
        >
          Back to your lessons
        </LinkButton>
      }
    >
      The link may be wrong.
    </StatusPage>
  );
}
