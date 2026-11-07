import type Anthropic from "@anthropic-ai/sdk";

type OneToolParams = Pick<
  Anthropic.MessageCreateParamsNonStreaming,
  "tool_choice" | "thinking" | "output_config"
>;

/**
 * How each model turns thinking off, or as near as it allows. These calls hand back one tool's
 * input and were designed without thinking (a forced choice ran without it), so its tokens would
 * only eat the call's `max_tokens`. Sonnet 5.5 refuses `disabled` and takes `between_tools`; Opus
 * 5.5 and Fable 5.1 can't turn it off at all, so they think at low effort. Any other model takes
 * `disabled`.
 */
const THINKING_OFF: Readonly<Record<string, Omit<OneToolParams, "tool_choice">>> = {
  "claude-sonnet-5-5": { thinking: { type: "between_tools" } },
  "claude-opus-5-5": { output_config: { effort: "low" } },
  "claude-fable-5-1": { output_config: { effort: "low" } },
};

/**
 * Request fields and a closing prompt line that get exactly one call of one tool from any model.
 * Several current models (Sonnet 5.5, Opus 5.5, Fable 5.1) refuse a forced `tool_choice` with a
 * 400, so no call forces one: the choice is `auto`, at most one call, and the prompt names the
 * tool. The tool's `strict` schema keeps its input valid. A model may still answer in text; the
 * caller treats a reply without the tool call as unusable, as it treats bad input.
 */
export function oneToolCall(
  model: string,
  tool: string,
): { params: OneToolParams; instruction: string } {
  return {
    params: {
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      ...(THINKING_OFF[model] ?? { thinking: { type: "disabled" } }),
    },
    instruction: `Answer by calling ${tool}, once, and write nothing else.`,
  };
}
