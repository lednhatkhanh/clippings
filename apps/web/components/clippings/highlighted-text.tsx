import type { TextSegment } from "@clippings/shared";

/** Text with the terms a search matched marked. */
export function HighlightedText({ segments }: { segments: TextSegment[] }) {
  return segments.map((segment, index) =>
    segment.match ? (
      <mark key={index} className="rounded-xs bg-tertiary-container text-on-tertiary-container">
        {segment.text}
      </mark>
    ) : (
      segment.text
    ),
  );
}
