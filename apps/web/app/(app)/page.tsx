import { NotebookIllustration } from "@clippings/ui";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-180">
      <h1 className="py-4 typescale-headline-sm">Clippings</h1>
      <section className="flex flex-col items-center gap-4 py-12 text-center">
        <NotebookIllustration className="h-auto w-50" />
        <h2 className="typescale-title-lg">Nothing clipped yet</h2>
        <p className="typescale-body-md text-on-surface-variant">
          Pages you save will show up here.
        </p>
      </section>
    </div>
  );
}
