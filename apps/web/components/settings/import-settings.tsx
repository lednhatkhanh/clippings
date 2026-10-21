"use client";

import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { FileTrigger } from "react-aria-components";

import {
  importBookmarksAction,
  previewBookmarksImportAction,
} from "@/app/(app)/settings/actions.ts";
import {
  bookmarksFileProblem,
  describeImported,
  describePending,
  describePreview,
  IMPORT_REQUEST_FAILED,
  type ImportDone,
  type ImportPreview,
} from "@/lib/settings/import.ts";
import { Button, ProgressBar, Segment, SegmentedButtons } from "@clippings/ui";

import { SettingsCard, SettingsRow } from "./settings-section.tsx";

type Stage =
  | { kind: "idle" }
  | { kind: "checking"; file: File }
  | { kind: "preview"; file: File; preview: ImportPreview }
  | { kind: "importing"; file: File; preview: ImportPreview }
  | { kind: "done"; done: ImportDone }
  | { kind: "error"; message: string };

function formData(file: File, foldersAsTags: boolean): FormData {
  const body = new FormData();
  body.set("file", file);
  body.set("foldersAsTags", String(foldersAsTags));
  return body;
}

/**
 * Importing a bookmarks HTML file: choose it, see what would happen, then confirm. The server
 * parses the file; the browser only refuses one that is too large before sending it.
 */
export function ImportSettings({ pendingImports }: { pendingImports: number }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [foldersAsTags, setFoldersAsTags] = useState(true);
  // The file whose answer the page is waiting for, so a slow reply for an older one is dropped.
  const current = useRef<File | null>(null);

  async function choose(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    current.current = file;
    const problem = bookmarksFileProblem(file);
    if (problem) {
      setStage({ kind: "error", message: problem });
      return;
    }
    setStage({ kind: "checking", file });
    const result = await previewBookmarksImportAction(formData(file, foldersAsTags)).catch(
      () => null,
    );
    if (current.current !== file) return;
    if (!result) setStage({ kind: "error", message: IMPORT_REQUEST_FAILED });
    else if (!result.ok) setStage({ kind: "error", message: result.message });
    else setStage({ kind: "preview", file, preview: result.value });
  }

  async function confirm(file: File, preview: ImportPreview) {
    setStage({ kind: "importing", file, preview });
    const result = await importBookmarksAction(formData(file, foldersAsTags)).catch(() => null);
    if (current.current !== file) return;
    if (!result) setStage({ kind: "error", message: IMPORT_REQUEST_FAILED });
    else if (!result.ok) setStage({ kind: "error", message: result.message });
    else setStage({ kind: "done", done: result.value });
  }

  function cancel() {
    current.current = null;
    setStage({ kind: "idle" });
  }

  const busy = stage.kind === "checking" || stage.kind === "importing";
  const pending = describePending(stage.kind === "done" ? stage.done.pending : pendingImports);

  return (
    <SettingsCard title="Import">
      <SettingsRow
        title="Bookmarks file"
        description="Import bookmarks from Chrome, Firefox, Safari, Raindrop or any service that exports a bookmarks HTML file. Saved dates are kept, and imported clippings are read gradually in the background."
      >
        <FileTrigger acceptedFileTypes={["text/html", ".html", ".htm"]} onSelect={choose}>
          <Button variant="paper" isDisabled={busy}>
            <FileUp className="size-4.5" />
            Choose file
          </Button>
        </FileTrigger>
      </SettingsRow>

      <output className="flex flex-col divide-y divide-line empty:hidden">
        {stage.kind === "checking" ? (
          <div className="flex flex-col gap-3 py-4.5">
            <p className="typescale-body-md text-ink-muted">{`Reading ${stage.file.name}…`}</p>
            <ProgressBar label="Reading the bookmarks file" />
          </div>
        ) : null}

        {stage.kind === "error" ? (
          <p className="py-4.5 typescale-body-md text-danger">{stage.message}</p>
        ) : null}

        {stage.kind === "preview" || stage.kind === "importing" ? (
          <div className="flex flex-col gap-4 py-4.5">
            <p className="typescale-body-md text-ink">
              <span className="typescale-title-sm break-all">{stage.file.name}</span>
              <br />
              {describePreview(stage.preview)}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="typescale-title-sm">Turn folders into tags</div>
                <div className="typescale-body-sm text-ink-faint">
                  Each bookmark gets a tag for every folder it sits in.
                </div>
              </div>
              <SegmentedButtons
                aria-label="Turn folders into tags"
                className="medium:w-auto"
                selectedKey={foldersAsTags ? "on" : "off"}
                isDisabled={stage.kind === "importing"}
                onSelectionChange={(key) => setFoldersAsTags(key === "on")}
              >
                <Segment id="on">On</Segment>
                <Segment id="off">Off</Segment>
              </SegmentedButtons>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="text" isDisabled={stage.kind === "importing"} onPress={cancel}>
                Cancel
              </Button>
              <Button
                isPending={stage.kind === "importing"}
                isDisabled={stage.preview.willImport === 0}
                onPress={() => void confirm(stage.file, stage.preview)}
              >
                {stage.preview.willImport === 0 ? "Nothing to import" : "Import"}
              </Button>
            </div>
          </div>
        ) : null}

        {stage.kind === "done" ? (
          <p className="py-4.5 typescale-body-md text-ink">{describeImported(stage.done)}</p>
        ) : null}

        {pending ? <p className="py-4.5 typescale-body-md text-ink-muted">{pending}</p> : null}
      </output>
    </SettingsCard>
  );
}
