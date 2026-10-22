"use client";

import { MessageCircleQuestion, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useOnline } from "@/components/online-status.tsx";
import { askRequestSchema, MAX_QUESTION_LENGTH } from "@clippings/shared";
import { Button, TextField } from "@clippings/ui";

import {
  ASKING_ANSWER,
  endAnswer,
  IDLE_ANSWER,
  readEvents,
  reduceAnswer,
  type AnswerState,
} from "./answer.ts";

const FAILED_MESSAGE = "Couldn't get an answer. Try again.";

/** The question field and the answer under it, streamed in as the model writes it. */
export function AskForm() {
  const online = useOnline();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AnswerState>(IDLE_ANSWER);
  // The request in flight, so a new question (or leaving the page) cancels it.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const asking = answer.status === "asking";
  const canAsk = askRequestSchema.safeParse({ question }).success && online;

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!canAsk || asking) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    let state = ASKING_ANSWER;
    const show = (next: AnswerState) => {
      state = next;
      if (inFlight.current === controller) setAnswer(next);
    };
    show(state);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        show({
          ...IDLE_ANSWER,
          status: "error",
          error: response.status === 401 ? "Sign in again to ask." : FAILED_MESSAGE,
        });
        return;
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      for (;;) {
        const { value, done } = await reader.read();
        const read = readEvents(rest, done ? "\n" : value);
        rest = read.rest;
        for (const streamEvent of read.events) show(reduceAnswer(state, streamEvent));
        if (done) break;
      }
      show(endAnswer(state));
    } catch {
      if (!controller.signal.aborted) {
        show({ ...state, status: "error", error: FAILED_MESSAGE });
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={ask} className="flex flex-col gap-3 rounded-xl paper p-4 medium:p-5">
        <TextField
          label="Your question"
          placeholder="What did I save about…?"
          value={question}
          onChange={setQuestion}
          maxLength={MAX_QUESTION_LENGTH}
          autoComplete="off"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="typescale-body-sm text-ink-muted">
            {online ? "Answers come from your clippings only." : "Asking needs a connection."}
          </p>
          <Button type="submit" isDisabled={!canAsk} isPending={asking}>
            <Send className="size-4" />
            Ask
          </Button>
        </div>
      </form>

      <section aria-label="Answer" aria-live="polite" aria-busy={asking}>
        {answer.status === "idle" ? <AskEmptyState /> : <Answer answer={answer} />}
      </section>
    </div>
  );
}

function AskEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl paper px-6 py-12 text-center">
      <MessageCircleQuestion aria-hidden="true" className="size-8 text-ink-muted" />
      <h2 className="typescale-title-lg">Ask your clippings</h2>
      <p className="max-w-100 typescale-body-md text-ink-muted">
        Ask a question and get an answer drawn only from the pages and notes you saved, with the
        clippings it came from. Nothing outside your clippings is used.
      </p>
    </div>
  );
}

function Answer({ answer }: { answer: AnswerState }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl paper p-5 medium:p-6">
      {answer.parts.length === 0 && answer.status === "asking" ? (
        <p className="typescale-body-md text-ink-muted">Searching your clippings…</p>
      ) : (
        <p className="typescale-reading whitespace-pre-wrap">
          {answer.parts.map((part, index) =>
            part.type === "text" ? (
              <span key={index}>{part.text}</span>
            ) : (
              <sup key={index} className="mx-0.5 typescale-label-sm text-ink-muted">
                <span className="sr-only">Source </span>
                {part.number}
              </sup>
            ),
          )}
        </p>
      )}
      {answer.status === "error" ? (
        <p role="alert" className="typescale-body-md text-danger">
          {answer.error}
        </p>
      ) : null}
      {answer.sources.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <h2 className="typescale-label-md tracking-widest text-ink-faint uppercase">Sources</h2>
          <ol className="flex flex-col gap-1.5">
            {answer.sources.map((source, index) => (
              <li key={source.id} className="flex gap-2 typescale-body-md">
                <span className="w-5 shrink-0 text-ink-muted tabular-nums">{index + 1}</span>
                <Link
                  href={`/c/${source.id}`}
                  className="min-w-0 truncate text-accent-ink underline-offset-2 hover:underline"
                >
                  {source.title}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
