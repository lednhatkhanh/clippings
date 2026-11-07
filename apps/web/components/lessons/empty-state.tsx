import { NotebookIllustration } from "@clippings/ui";

export function LessonsEmptyState() {
  return (
    <section className="mx-auto flex flex-col items-center gap-4 rounded-xl paper px-6 py-12 text-center">
      <NotebookIllustration className="h-auto w-50" />
      <h2 className="typescale-title-lg">No lessons yet</h2>
      <p className="max-w-100 typescale-body-md text-ink-muted">
        A new lesson arrives on Tuesdays and Fridays, written from what you save. Save a few
        clippings and notes, and the first one will be here.
      </p>
    </section>
  );
}
