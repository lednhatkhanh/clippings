import { Illustration, ink, type IllustrationProps } from "./illustration.tsx";

/** An open notebook with a single paper clip: the empty clippings list. */
export function NotebookIllustration(props: IllustrationProps) {
  return (
    <Illustration {...props}>
      <path d="M44 46l76 8v74l-76-8z" className="fill-accent-soft" />
      <g {...ink}>
        <path d="M40 40l80 10v74l-80-10zM120 50l80-10v74l-80 10z" className="fill-paper" />
        <path d="M58 64l46 6M58 80l46 6M58 96l30 4M136 70l46-6M136 86l46-6" />
        <path d="M168 30v34a6 6 0 0 1-12 0V34a10 10 0 0 1 20 0v28" />
      </g>
    </Illustration>
  );
}
