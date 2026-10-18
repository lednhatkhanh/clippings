import { LinkButton } from "@clippings/ui";

/** A clipping that was deleted, belongs to someone else, or never existed: all look the same. */
export default function ClippingNotFound() {
  return (
    <div className="mx-auto flex max-w-180 flex-col items-start gap-4 py-8">
      <h1 className="typescale-headline-sm">This clipping isn&apos;t here</h1>
      <p className="typescale-body-lg text-on-surface-variant">
        It may have been deleted, or the link is wrong.
      </p>
      <LinkButton variant="tonal" href="/">
        Back to your clippings
      </LinkButton>
    </div>
  );
}
