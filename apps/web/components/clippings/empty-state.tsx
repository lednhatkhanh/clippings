import { SkipLaunchParam } from "@/components/skip-launch-param.tsx";
import { NotebookIllustration } from "@clippings/ui";

export function EmptyState() {
  return (
    <section className="flex flex-col items-center gap-4 py-12 text-center">
      {/* The Search shortcut has no list to search yet. */}
      <SkipLaunchParam name="search" />
      <NotebookIllustration className="h-auto w-50" />
      <h2 className="typescale-title-lg">Nothing clipped yet</h2>
      <p className="max-w-100 typescale-body-md text-ink-muted">
        Save a page with the extension, ask Claude to clip something, or drop a link here.
      </p>
    </section>
  );
}
