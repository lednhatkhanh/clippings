import { Illustration, ink, type IllustrationProps } from "./illustration.tsx";

/** A small stack of pinned clippings: the sign-in page. */
export function ClippingsStackIllustration(props: IllustrationProps) {
  return (
    <Illustration {...props}>
      <rect x="62" y="42" width="116" height="84" rx="4" className="fill-accent-soft" />
      <g {...ink} transform="rotate(-6 120 80)">
        <rect x="56" y="34" width="116" height="84" rx="4" className="fill-ground-sunk" />
      </g>
      <g {...ink}>
        <rect x="64" y="30" width="116" height="84" rx="4" className="fill-paper" />
        <path d="M80 54h54M80 68h84M80 82h72M80 96h40" />
        <circle cx="172" cy="38" r="6" className="fill-accent" />
        <path d="M172 44v10" />
      </g>
    </Illustration>
  );
}
