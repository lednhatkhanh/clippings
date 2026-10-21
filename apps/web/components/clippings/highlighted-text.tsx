import type { TextSegment } from "@clippings/shared";

/** Text with the terms a search matched marked. */
export function HighlightedText({ segments }: { segments: TextSegment[] }) {
  return segments.map((segment, index) =>
    segment.match ? (
      <mark
        key={index}
        className="bg-transparent font-semibold text-inherit underline decoration-accent decoration-2 underline-offset-3"
      >
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}
