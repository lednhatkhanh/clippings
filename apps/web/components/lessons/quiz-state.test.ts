import { describe, expect, it } from "vitest";

import { choiceState, type ChoiceState } from "./quiz-state.ts";

describe("choiceState", () => {
  // Choices 0-2, the answer is 1.
  const states = (chosen: number | null, checked: boolean): ChoiceState[] =>
    [0, 1, 2].map((index) => choiceState({ index, chosen, answerIndex: 1, checked }));

  it.each([
    ["nothing chosen", null, false, ["idle", "idle", "idle"]],
    ["a choice picked, not yet checked", 0, false, ["chosen", "idle", "idle"]],
    ["the right choice picked, not yet checked", 1, false, ["idle", "chosen", "idle"]],
    ["the right choice checked", 1, true, ["idle", "correct", "idle"]],
    ["a wrong choice checked: the right one is shown", 2, true, ["idle", "missed", "wrong"]],
  ] as const)("%s", (_name, chosen, checked, expected) => {
    expect(states(chosen, checked)).toEqual(expected);
  });
});
