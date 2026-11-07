"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";

import type { LessonQuiz } from "@clippings/shared";
import { Button, cn } from "@clippings/ui";

import { choiceState, type ChoiceState } from "./quiz-state.ts";

/** How a choice looks in each state; marks carry the meaning as well as the color. */
const CHOICE_STYLES: Record<ChoiceState, string> = {
  idle: "paper text-ink",
  chosen: "bg-accent-soft text-on-accent-soft",
  correct: "bg-accent-soft text-on-accent-soft",
  missed: "bg-accent-soft text-on-accent-soft",
  wrong: "bg-danger-soft text-on-danger-soft",
};

const CHOICE_NOTES: Partial<Record<ChoiceState, string>> = {
  correct: "Correct answer, your pick",
  missed: "Correct answer",
  wrong: "Your pick",
};

/**
 * The lesson's one multiple-choice question. Pick a choice, check it, and the right one is marked
 * with why. Nothing is saved: opening the lesson again asks again.
 */
export function LessonQuizQuestion({ quiz }: { quiz: LessonQuiz }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={chosen === null ? null : String(chosen)}
        onChange={(value) => setChosen(Number(value))}
        isReadOnly={checked}
        className="flex flex-col gap-3"
      >
        <Label className="typescale-title-md text-pretty">{quiz.question}</Label>
        <div className="flex flex-col gap-2.5">
          {quiz.choices.map((choice, index) => {
            const state = choiceState({ index, chosen, answerIndex: quiz.answerIndex, checked });
            const note = CHOICE_NOTES[state];
            return (
              <Radio
                key={index}
                value={String(index)}
                className={cn(
                  "flex min-h-11 cursor-default items-start gap-3 rounded-md px-3.5 py-3 typescale-body-lg transition-colors",
                  CHOICE_STYLES[state],
                  !checked && "lift",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-edge",
                    (state === "chosen" || state === "correct" || state === "missed") &&
                      "border-accent bg-accent text-on-accent",
                    state === "wrong" && "border-on-danger-soft",
                  )}
                >
                  {state === "correct" || state === "missed" ? (
                    <Check className="size-3.5" />
                  ) : null}
                  {state === "wrong" ? <X className="size-3.5" /> : null}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-pretty wrap-anywhere">{choice}</span>
                  {note ? <span className="typescale-label-md">{note}</span> : null}
                </span>
              </Radio>
            );
          })}
        </div>
      </RadioGroup>

      {checked ? null : (
        <Button
          variant="paper"
          isDisabled={chosen === null}
          onPress={() => setChecked(true)}
          className="self-start"
        >
          Check answer
        </Button>
      )}

      {/* Always mounted, so a screen reader announces the result when it fills in. */}
      <output className="block empty:-mt-4">
        {checked ? (
          <div className="flex flex-col gap-2 rounded-md bg-ground-sunk p-4">
            <p className="typescale-title-sm">
              {chosen === quiz.answerIndex ? "That's right." : "Not quite."}
            </p>
            <p className="typescale-body-lg text-pretty">{quiz.explanation}</p>
          </div>
        ) : null}
      </output>
    </div>
  );
}
