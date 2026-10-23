import { AskForm } from "@/components/ask/ask-form.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { PageTransition } from "@/components/page-transition.tsx";

export default function AskPage() {
  return (
    <PageTransition>
      <div className="mx-auto max-w-220 pb-4">
        <PageHeader title="Ask" eyebrow="Your library" />
        <AskForm />
      </div>
    </PageTransition>
  );
}
