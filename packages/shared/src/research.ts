import * as z from "zod";

/** Longest "About me" text, in characters. */
export const MAX_RESEARCH_PROFILE_LENGTH = 1_000;
/** Most research domains a user can name. */
export const MAX_RESEARCH_DOMAINS = 10;
/** Longest single research domain, in characters. */
export const MAX_RESEARCH_DOMAIN_LENGTH = 60;

/** What a user tells the research briefs about themselves. */
export interface ResearchSettings {
  /** Who they are and what they work on; aims the brief at them. */
  profile: string;
  /** The topics worth researching. Empty means research is off. */
  domains: string[];
}

export const RESEARCH_DEFAULTS: ResearchSettings = {
  profile: "",
  domains: ["shipping", "logistics"],
};

/**
 * The domains in text a form sends: separated by commas or newlines, each trimmed, blanks dropped,
 * repeats (ignoring case) dropped with the first spelling kept. Limits are the schema's to check.
 */
export function parseResearchDomains(text: string): string[] {
  return normalizeResearchDomains(text.split(/[,\n]/));
}

function normalizeResearchDomains(parts: readonly string[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const part of parts) {
    const domain = part.trim();
    const key = domain.toLowerCase();
    if (domain === "" || seen.has(key)) continue;
    seen.add(key);
    domains.push(domain);
  }
  return domains;
}

/**
 * A change to the research settings, as a client sends it: either or both. Domains are trimmed,
 * blanks and repeats dropped; one too long, or more than `MAX_RESEARCH_DOMAINS` of them, is
 * refused with a message, never cut.
 */
export const researchSettingsChangeSchema = z
  .object({
    profile: z
      .string()
      .trim()
      .max(
        MAX_RESEARCH_PROFILE_LENGTH,
        `About me can be at most ${MAX_RESEARCH_PROFILE_LENGTH} characters`,
      ),
    domains: z
      .array(z.string())
      .transform(normalizeResearchDomains)
      .pipe(
        z
          .array(
            z
              .string()
              .max(
                MAX_RESEARCH_DOMAIN_LENGTH,
                `A domain can be at most ${MAX_RESEARCH_DOMAIN_LENGTH} characters`,
              ),
          )
          .max(MAX_RESEARCH_DOMAINS, `At most ${MAX_RESEARCH_DOMAINS} domains`),
      ),
  })
  .partial()
  .strict()
  .refine((change) => Object.keys(change).length > 0, "Nothing to change");

export type ResearchSettingsChange = z.infer<typeof researchSettingsChangeSchema>;

export const BRIEF_STATUSES = ["queued", "submitted", "writing", "ready", "dropped"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

/** How a brief is written: in the daily batch, or right away because the user asked. */
export const BRIEF_MODES = ["batch", "now"] as const;
export type BriefMode = (typeof BRIEF_MODES)[number];

/** Who wrote a brief. Only the model does for now. */
export const BRIEF_SOURCES = ["ai"] as const;
export type BriefAuthor = (typeof BRIEF_SOURCES)[number];

/** Longest brief body, in characters of Markdown. */
export const MAX_BRIEF_LENGTH = 40_000;

/** A page a brief drew on. */
export interface BriefSource {
  url: string;
  title: string;
}

/** The research brief written for a clipping. JSON-safe. */
export interface Brief {
  id: string;
  clippingId: string;
  /** The research domain the save was in; empty for a brief the user asked for by hand. */
  domain: string;
  /** Why it was worth researching. */
  reason: string;
  status: BriefStatus;
  mode: BriefMode;
  /** Markdown; null until the brief is ready. */
  body: string | null;
  sources: BriefSource[];
  /** Why the brief was dropped or put back in the queue, for the user. */
  note: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  /** ISO 8601; when the brief became ready or was dropped. */
  completedAt: string | null;
}
