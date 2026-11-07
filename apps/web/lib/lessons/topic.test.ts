import { describe, expect, it } from "vitest";

import type {
  LessonMaterial,
  LessonMaterialItem,
  LessonMaterialTag,
  PastLesson,
} from "@clippings/db";

import { pickLessonTopic, type LessonTopic } from "./topic.ts";

let counter = 0;

function tag(name: string, overrides: Partial<LessonMaterialTag> = {}): LessonMaterialTag {
  return {
    id: `tag-${name}`,
    name,
    itemCount: 2,
    recentCount: 0,
    newestItemAt: "2026-11-01T00:00:00.000Z",
    topicPage: { body: "A page", updatedAt: "2026-11-02T00:00:00.000Z" },
    ...overrides,
  };
}

const item = (): LessonMaterialItem => ({
  id: `item-${counter++}`,
  kind: "link",
  title: "A save",
  summary: null,
  excerpt: null,
  tagIds: [],
  savedAt: "2026-11-05T00:00:00.000Z",
});

function lesson(tagName: string | null): PastLesson {
  return {
    id: `lesson-${counter++}`,
    day: "2026-10-01",
    topic: "A topic",
    tagId: tagName && `tag-${tagName}`,
    body: "Body",
    quiz: { question: "Q?", choices: ["a", "b", "c"], answerIndex: 0, explanation: "Because." },
  };
}

function material(parts: Partial<LessonMaterial>): LessonMaterial {
  return { profile: "", recent: [], tags: [], past: [], ...parts };
}

const pick = (name: string, why: "recent" | "gap"): LessonTopic => ({
  kind: "tag",
  tagId: `tag-${name}`,
  name,
  why,
});

describe("pickLessonTopic", () => {
  const cases: [string, LessonMaterial, ReturnType<typeof pickLessonTopic>][] = [
    ["an empty library", material({}), null],
    [
      "the tag with the most recent saves",
      material({
        tags: [tag("css", { recentCount: 1 }), tag("rust", { recentCount: 3 })],
        recent: [item()],
      }),
      pick("rust", "recent"),
    ],
    [
      "a tag with three items and no topic page is a gap",
      material({ tags: [tag("db", { itemCount: 3, topicPage: null })] }),
      pick("db", "gap"),
    ],
    [
      "two items and no topic page is not a gap (a gap would outscore one recent save)",
      material({
        tags: [tag("db", { itemCount: 2, topicPage: null }), tag("css", { recentCount: 1 })],
      }),
      pick("css", "recent"),
    ],
    [
      "a topic page older than the newest item is a gap",
      material({
        tags: [
          tag("css", {
            newestItemAt: "2026-11-05T00:00:00.000Z",
            topicPage: { body: "Old", updatedAt: "2026-11-01T00:00:00.000Z" },
          }),
        ],
      }),
      pick("css", "gap"),
    ],
    [
      "a topic page as new as the newest item is no gap",
      material({
        tags: [
          tag("css", {
            newestItemAt: "2026-11-05T00:00:00.000Z",
            topicPage: { body: "Fresh", updatedAt: "2026-11-05T00:00:00.000Z" },
          }),
          tag("rust", { recentCount: 1 }),
        ],
      }),
      pick("rust", "recent"),
    ],
    [
      "a gap (3) beats a single recent save (2)",
      material({
        tags: [tag("css", { recentCount: 1 }), tag("db", { itemCount: 5, topicPage: null })],
      }),
      pick("db", "gap"),
    ],
    [
      "recent saves outweigh a gap (2 x 2 > 3), and the tag counts as recent",
      material({
        tags: [
          tag("css", { recentCount: 2 }),
          tag("db", { itemCount: 5, recentCount: 0, topicPage: null }),
        ],
      }),
      pick("css", "recent"),
    ],
    [
      "a gap with recent saves is picked for the recent saves",
      material({ tags: [tag("db", { itemCount: 4, recentCount: 1, topicPage: null })] }),
      pick("db", "recent"),
    ],
    [
      "equal scores go to the tag with more items",
      material({
        tags: [
          tag("css", { recentCount: 1, itemCount: 4 }),
          tag("rust", { recentCount: 1, itemCount: 9 }),
        ],
      }),
      pick("rust", "recent"),
    ],
    [
      "equal scores and sizes go to the name",
      material({
        tags: [
          tag("rust", { recentCount: 1, itemCount: 4 }),
          tag("css", { recentCount: 1, itemCount: 4 }),
        ],
      }),
      pick("css", "recent"),
    ],
    [
      "a tag of one of the last four lessons is on cooldown",
      material({
        tags: [tag("rust", { recentCount: 5 }), tag("css", { recentCount: 1 })],
        past: [lesson(null), lesson(null), lesson(null), lesson("rust")],
      }),
      pick("css", "recent"),
    ],
    [
      "a tag of the fifth lesson back is free again",
      material({
        tags: [tag("rust", { recentCount: 5 }), tag("css", { recentCount: 1 })],
        past: [lesson(null), lesson(null), lesson(null), lesson(null), lesson("rust")],
      }),
      pick("rust", "recent"),
    ],
    [
      "recent saves are the topic when no tag stands out",
      material({ tags: [tag("css")], recent: [item()] }),
      { kind: "recent" },
    ],
    [
      "recent saves are the topic when every standout tag is on cooldown",
      material({
        tags: [tag("rust", { recentCount: 2 })],
        recent: [item()],
        past: [lesson("rust")],
      }),
      { kind: "recent" },
    ],
    [
      "with nothing recent, the biggest tag off cooldown",
      material({
        tags: [
          tag("css", { itemCount: 2 }),
          tag("rust", { itemCount: 2 }),
          tag("db", { itemCount: 1 }),
        ],
      }),
      pick("css", "recent"),
    ],
    [
      "the biggest tag skips cooldown",
      material({
        tags: [tag("css", { itemCount: 2 }), tag("rust", { itemCount: 2 })],
        past: [lesson("css")],
      }),
      pick("rust", "recent"),
    ],
    [
      "nothing when every tag is on cooldown and nothing is recent",
      material({ tags: [tag("css")], past: [lesson("css")] }),
      null,
    ],
  ];

  it.each(cases)("picks %s", (_name, input, expected) => {
    expect(pickLessonTopic(input)).toEqual(expected);
  });
});
