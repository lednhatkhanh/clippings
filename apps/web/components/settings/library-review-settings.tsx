import { LinkButton } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

/**
 * The way into the library review: what the librarian did and suggests. It says how many
 * suggestions wait, so the Library tab shows when there is something to decide.
 */
export function LibraryReviewSettings({ waiting }: { waiting: number }) {
  return (
    <SettingsCard title="Librarian">
      <SettingsRow
        title="Review the librarian's changes"
        description={
          waiting === 0
            ? "Nothing is waiting for you. See what was changed lately, and undo it if you like."
            : `${waiting === 1 ? "1 suggestion is" : `${waiting} suggestions are`} waiting for your decision. Recent changes can be undone there too.`
        }
      >
        <LinkButton href="/settings/library" variant="paper">
          {waiting === 0 ? "Open review" : `Review (${waiting})`}
        </LinkButton>
      </SettingsRow>
    </SettingsCard>
  );
}
