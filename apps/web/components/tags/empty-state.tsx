import { ClippingsStackIllustration } from "@clippings/ui";

export function TagsEmptyState() {
  return (
    <section className="flex flex-col items-center gap-4 py-12 text-center">
      <ClippingsStackIllustration className="h-auto w-50" />
      <h2 className="typescale-title-lg">No tags yet</h2>
      <p className="max-w-100 typescale-body-md text-on-surface-variant">
        Tags appear when you add them to a clipping
      </p>
    </section>
  );
}
