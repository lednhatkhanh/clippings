import type Anthropic from "@anthropic-ai/sdk";
import * as z from "zod";

import { LIBRARY_CHANGE_CONFIDENCES, TAG_COLORS } from "@clippings/shared";

const confidence = z.enum(LIBRARY_CHANGE_CONFIDENCES);

/** What the model plans for the tag set: merges, renames, folds and tags that are too broad. */
export const tagPlanSchema = z.object({
  merges: z.array(
    z.object({ source: z.string(), target: z.string(), reason: z.string(), confidence }),
  ),
  renames: z.array(z.object({ tag: z.string(), name: z.string(), reason: z.string(), confidence })),
  folds: z.array(z.object({ tag: z.string(), into: z.string(), reason: z.string(), confidence })),
  too_broad: z.array(z.object({ tag: z.string(), reason: z.string() })),
});
export type TagPlan = z.infer<typeof tagPlanSchema>;

/** What the model plans for the folders: new folders, and where each listed item goes. */
export const folderPlanSchema = z.object({
  folders: z.array(
    z.object({
      name: z.string(),
      color: z.enum(TAG_COLORS),
      reason: z.string(),
      confidence,
    }),
  ),
  moves: z.array(z.object({ ref: z.string(), folder: z.string(), confidence })),
});
export type FolderPlan = z.infer<typeof folderPlanSchema>;

export const linkPlanSchema = z.object({
  links: z.array(z.object({ a: z.string(), b: z.string(), reason: z.string(), confidence })),
});
export type LinkPlan = z.infer<typeof linkPlanSchema>;

export const topicPagePlanSchema = z.object({
  pages: z.array(
    z.object({
      tag: z.string(),
      overview: z.string(),
      items: z.array(z.object({ ref: z.string(), summary: z.string() })),
      confidence,
    }),
  ),
});
export type TopicPagePlan = z.infer<typeof topicPagePlanSchema>;

/** Haiku's verdicts on proposed links. */
export const linkVerdictsSchema = z.object({
  verdicts: z.array(z.object({ index: z.number(), keep: z.boolean() })),
});

/** Everything the planner decided, whole: the input to the pure step that makes the proposals. */
export interface LibraryPlan {
  merges: TagPlan["merges"];
  renames: TagPlan["renames"];
  folds: TagPlan["folds"];
  tooBroad: TagPlan["too_broad"];
  folders: FolderPlan["folders"];
  moves: FolderPlan["moves"];
  /** Only the links Haiku kept. */
  links: LinkPlan["links"];
  pages: TopicPagePlan["pages"];
}

export const EMPTY_PLAN: LibraryPlan = {
  merges: [],
  renames: [],
  folds: [],
  tooBroad: [],
  folders: [],
  moves: [],
  links: [],
  pages: [],
};

const CONFIDENCE = { type: "string", enum: [...LIBRARY_CHANGE_CONFIDENCES] } as const;
const STRING = { type: "string" } as const;

function strictTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
): Anthropic.Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

function list(properties: Record<string, unknown>) {
  return {
    type: "array",
    items: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

export const PLAN_TAGS = "plan_tags";
export const PLAN_FOLDERS = "plan_folders";
export const PLAN_LINKS = "plan_links";
export const PLAN_TOPIC_PAGES = "plan_topic_pages";
export const CONFIRM_LINKS = "confirm_links";

/**
 * The planner's tools. Every planning call sends all four and forces one with `tool_choice`:
 * the tool list is the first thing a prompt cache keys on, so identical tools let each stage read
 * the library block the first one wrote.
 */
export const PLANNER_TOOLS: Anthropic.Tool[] = [
  strictTool(
    PLAN_TAGS,
    "Plans changes to the tag set: tags to merge, rename or fold, and tags that are too broad.",
    {
      merges: list({ source: STRING, target: STRING, reason: STRING, confidence: CONFIDENCE }),
      renames: list({ tag: STRING, name: STRING, reason: STRING, confidence: CONFIDENCE }),
      folds: list({ tag: STRING, into: STRING, reason: STRING, confidence: CONFIDENCE }),
      too_broad: list({ tag: STRING, reason: STRING }),
    },
  ),
  strictTool(
    PLAN_FOLDERS,
    "Plans the folders and files the listed items and tags in them, each in exactly one.",
    {
      folders: list({
        name: STRING,
        color: { type: "string", enum: [...TAG_COLORS] },
        reason: STRING,
        confidence: CONFIDENCE,
      }),
      moves: list({ ref: STRING, folder: STRING, confidence: CONFIDENCE }),
    },
  ),
  strictTool(PLAN_LINKS, "Plans links between items that belong together, with a reason.", {
    links: list({ a: STRING, b: STRING, reason: STRING, confidence: CONFIDENCE }),
  }),
  strictTool(PLAN_TOPIC_PAGES, "Writes the topic pages of the listed tags.", {
    pages: list({
      tag: STRING,
      overview: STRING,
      items: list({ ref: STRING, summary: STRING }),
      confidence: CONFIDENCE,
    }),
  }),
];

export const CONFIRM_LINKS_TOOL: Anthropic.Tool = strictTool(
  CONFIRM_LINKS,
  "Records which proposed links are real.",
  { verdicts: list({ index: { type: "integer" }, keep: { type: "boolean" } }) },
);
