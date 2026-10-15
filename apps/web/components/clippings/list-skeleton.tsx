/** Row-shaped placeholders. They appear only after 150 ms, so a fast load shows nothing. */
export function ListSkeleton() {
  return (
    <div aria-hidden="true" className="flex appear-delayed flex-col">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex items-start gap-3 border-b border-outline-variant px-2 py-3"
        >
          <div className="size-5 shrink-0 rounded-xs bg-surface-container-high" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-6 w-3/5 rounded-xs bg-surface-container-high" />
            <div className="h-4 w-2/5 rounded-xs bg-surface-container-high" />
          </div>
        </div>
      ))}
    </div>
  );
}
