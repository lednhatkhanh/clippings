import { Illustration, ink, type IllustrationProps } from "./illustration.tsx";

/** A letterbox with a "members" card: the not-allowlisted page. */
export function LetterboxIllustration(props: IllustrationProps) {
  return (
    <Illustration {...props}>
      <rect x="62" y="48" width="116" height="76" rx="6" className="fill-secondary-container" />
      <g {...ink}>
        <rect x="56" y="42" width="116" height="76" rx="6" className="fill-surface" />
        <path d="M76 70h76" strokeWidth={3} />
        <path d="M84 118v16M144 118v16" />
        <rect x="88" y="22" width="52" height="38" rx="3" className="fill-surface" />
        <path d="M96 34h36M96 44h24" />
      </g>
    </Illustration>
  );
}
