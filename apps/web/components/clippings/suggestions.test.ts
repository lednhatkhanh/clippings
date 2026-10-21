import { describe, expect, it } from "vitest";

import { visibleSuggestions } from "./suggestions.ts";

describe("visibleSuggestions", () => {
  it.each([
    {
      name: "all of them when nothing is added or gone",
      suggested: ["css", "layout"],
      tags: [],
      gone: [],
      expected: ["css", "layout"],
    },
    {
      name: "drops one that matches a tag already added, ignoring case",
      suggested: ["CSS", "layout"],
      tags: ["css"],
      gone: [],
      expected: ["layout"],
    },
    {
      name: "drops one dismissed or accepted here",
      suggested: ["css", "layout"],
      tags: [],
      gone: ["Layout"],
      expected: ["css"],
    },
    {
      name: "shows a name once",
      suggested: ["css", "CSS"],
      tags: [],
      gone: [],
      expected: ["css"],
    },
    {
      name: "nothing when every suggestion is a tag",
      suggested: ["css"],
      tags: ["CSS"],
      gone: [],
      expected: [],
    },
  ])("$name", ({ suggested, tags, gone, expected }) => {
    expect(visibleSuggestions(suggested, tags, gone)).toEqual(expected);
  });
});
