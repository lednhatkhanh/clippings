import { ExternalLink } from "lucide-react";
import { Suspense, use, useState } from "react";
import { browser, type Browser } from "wxt/browser";

import { LOOKUP_PERMISSIONS, SHOW_SAVED_KEY, showsSavedPages } from "@/lib/settings.ts";
import { Button, Segment, SegmentedButtons } from "@clippings/ui";

/** Read before React renders, and read with `use`. */
const loading = Promise.all([showsSavedPages(), browser.commands.getAll()]);

/** What each shortcut does, by command name. */
const SHORTCUT_NAMES: Record<string, string> = {
  _execute_action: "Open Clippings and save the page",
  "save-silently": "Save the page without opening Clippings",
};

function ShowSavedSetting({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  async function change(key: string) {
    setProblem(null);
    try {
      if (key === "on") {
        // Asked in the press itself: the browser only shows the prompt for a user gesture.
        if (!(await browser.permissions.request(LOOKUP_PERMISSIONS))) {
          setProblem("Clippings needs to see your tabs' addresses for this. It stays off.");
          return;
        }
        await browser.storage.local.set({ [SHOW_SAVED_KEY]: true });
        setOn(true);
      } else {
        // Off first: with the setting off, nothing is looked up, whatever the permission.
        await browser.storage.local.set({ [SHOW_SAVED_KEY]: false });
        setOn(false);
        await browser.permissions.remove(LOOKUP_PERMISSIONS);
      }
    } catch (error) {
      console.error("Couldn't change the setting", error);
      setProblem("Couldn't change this setting. Try again.");
    }
  }

  return (
    <section aria-labelledby="show-saved" className="flex flex-col gap-3 rounded-lg paper p-5">
      <h2 id="show-saved" className="typescale-title-lg">
        Show when a page is already saved
      </h2>
      <p className="typescale-body-md text-ink-muted">
        The toolbar icon fills in on pages you&apos;ve saved. To know, Clippings checks each page
        you open with your account. While this is off, Clippings only hears about the pages you
        save.
      </p>
      <SegmentedButtons
        aria-label="Show when a page is already saved"
        selectedKey={on ? "on" : "off"}
        onSelectionChange={(key) => void change(key)}
        className="max-w-xs"
      >
        <Segment id="off">Off</Segment>
        <Segment id="on">On</Segment>
      </SegmentedButtons>
      {problem && (
        <p role="alert" className="typescale-body-sm text-danger">
          {problem}
        </p>
      )}
    </section>
  );
}

function Shortcuts({ commands }: { commands: Browser.commands.Command[] }) {
  return (
    <section aria-labelledby="shortcuts" className="flex flex-col gap-3 rounded-lg paper p-5">
      <h2 id="shortcuts" className="typescale-title-lg">
        Keyboard shortcuts
      </h2>
      <dl className="flex flex-col gap-2">
        {commands.map((command) => (
          <div key={command.name} className="flex items-baseline justify-between gap-4">
            <dt className="typescale-body-md">
              {SHORTCUT_NAMES[command.name ?? ""] ?? command.description}
            </dt>
            <dd className="typescale-label-lg font-mono text-ink-muted">
              {command.shortcut || "Not set"}
            </dd>
          </div>
        ))}
      </dl>
      <Button
        variant="outlined"
        className="self-start"
        // Chrome's own page: an extension can open it in a tab, though not link to it.
        onPress={() => void browser.tabs.create({ url: "chrome://extensions/shortcuts" })}
      >
        Change shortcuts
        <ExternalLink className="size-4.5" />
      </Button>
    </section>
  );
}

function Loaded() {
  const [showSaved, commands] = use(loading);
  return (
    <>
      <ShowSavedSetting initial={showSaved} />
      <Shortcuts commands={commands} />
    </>
  );
}

export function Options() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="typescale-headline-sm">Clippings settings</h1>
      <Suspense>
        <Loaded />
      </Suspense>
    </main>
  );
}
