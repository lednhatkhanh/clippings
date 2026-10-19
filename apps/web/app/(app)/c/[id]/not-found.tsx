import { StatusPage } from "@/components/status-page.tsx";
import { LinkButton } from "@clippings/ui";

/** A clipping that was deleted, belongs to someone else, or never existed: all look the same. */
export default function ClippingNotFound() {
  return (
    <StatusPage
      title="This clipping isn't here."
      actions={
        <LinkButton variant="tonal" href="/" routerOptions={{ transitionTypes: ["nav-back"] }}>
          Back to your clippings
        </LinkButton>
      }
    >
      It may have been deleted, or the link is wrong.
    </StatusPage>
  );
}
