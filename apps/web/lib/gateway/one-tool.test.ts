import { describe, expect, it } from "vitest";

import { oneToolCall } from "./one-tool.ts";

describe("oneToolCall", () => {
  it.each([
    // Refuses a forced choice and `disabled` thinking.
    ["claude-sonnet-5-5", { thinking: { type: "between_tools" } }],
    // Refuse a forced choice and can't turn thinking off.
    ["claude-opus-5-5", { output_config: { effort: "low" } }],
    ["claude-fable-5-1", { output_config: { effort: "low" } }],
    // Take `disabled`.
    ["claude-haiku-5-5", { thinking: { type: "disabled" } }],
    ["claude-sonnet-5", { thinking: { type: "disabled" } }],
  ])("asks %s for the tool without forcing it", (model, thinkingOff) => {
    const { params, instruction } = oneToolCall(model, "save_reading");

    expect(params).toEqual({
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      ...thinkingOff,
    });
    expect(instruction).toBe("Answer by calling save_reading, once, and write nothing else.");
  });
});
