/**
 * How a quiz choice shows. Before the answer is checked only the chosen one stands out; after, the
 * right choice is marked whether or not it was chosen, and a wrong pick is marked as wrong.
 */
export type ChoiceState = "idle" | "chosen" | "correct" | "wrong" | "missed";

export function choiceState({
  index,
  chosen,
  answerIndex,
  checked,
}: {
  index: number;
  /** The choice picked, or null while none is. */
  chosen: number | null;
  answerIndex: number;
  checked: boolean;
}): ChoiceState {
  if (!checked) return index === chosen ? "chosen" : "idle";
  if (index === answerIndex) return index === chosen ? "correct" : "missed";
  return index === chosen ? "wrong" : "idle";
}
