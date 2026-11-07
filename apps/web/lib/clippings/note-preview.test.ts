import { describe, expect, it } from "vitest";

import { notePreview } from "./note-preview.ts";

describe("notePreview", () => {
  it.each([
    ["the lines after the title", "Title\nfirst line\nsecond line", "first line second line"],
    [
      "Markdown marks taken off",
      "# Title\n\n- **bold** item\n- [a link](https://x.test) here",
      "bold item a link here",
    ],
    ["a body that is only its title", "Just a title", null],
    ["only marks after the title", "Title\n\n---\n***", null],
    ["a blank body", "", null],
  ])("makes %s", (_name, body, preview) => {
    expect(notePreview(body)).toBe(preview);
  });

  it("cuts a long body with an ellipsis", () => {
    const preview = notePreview(`Title\n${"word ".repeat(100)}`);
    expect(preview).toHaveLength(200);
    expect(preview?.endsWith("…")).toBe(true);
  });
});
