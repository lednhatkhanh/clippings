/** Row-shaped paper cards with wells where the text goes. They appear only after 150 ms, so a fast load shows nothing. */
export function ListSkeleton() {
  return (
    <div aria-hidden="true" className="flex appear-delayed flex-col gap-2.5">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-start gap-3.5 rounded-lg paper px-4 py-row-block">
          <div className="size-9 shrink-0 skeleton-pulse rounded-md bg-ground-sunk" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-6 w-3/5 skeleton-pulse rounded-xs bg-ground-sunk" />
            <div className="h-4 w-2/5 skeleton-pulse rounded-xs bg-ground-sunk" />
            <div className="h-4 w-full skeleton-pulse rounded-xs bg-ground-sunk" />
          </div>
        </div>
      ))}
    </div>
  );
}
