// Numbered scene/beat strip shared by the guided demo and the presenter. Every item is a real button (>= 44 px tall),
// the current one is aria-current="step", and the short names appear once there is room for them. The accessible name is
// built from what is on screen (WCAG 2.5.3 label in name): "Scene 3: An incident arrives" on narrow screens where only
// the number shows, "Scene 3: <short name>" once the short name is visible; the full title stays in the tooltip.
export interface SceneNavItem { title: string; short: string }

export function SceneNav({ label, prefix, items, index, onSelect, className = "" }: {
  label: string; prefix: string; items: readonly SceneNavItem[]; index: number; onSelect: (i: number) => void; className?: string;
}) {
  return (
    <ol aria-label={label} className={`flex gap-1 ${className}`}>
      {items.map((s, j) => {
        const here = j === index;
        return (
          <li key={s.title} className="min-w-0 flex-1">
            <button type="button" onClick={() => onSelect(j)} aria-current={here ? "step" : undefined} title={s.title}
              className={`group relative flex h-11 w-full items-center justify-center gap-2 rounded-md px-1 text-meta transition-colors duration-150 md:h-10 ${here ? "bg-surface-2 text-text" : j < index ? "text-text-2 hover:bg-surface hover:text-text" : "text-text-3 hover:bg-surface hover:text-text-2"}`}>
              <span className="sr-only">{prefix} </span>
              <span className="tnum font-medium">{j + 1}</span>
              <span className="sr-only">: </span>
              <span className="hidden truncate xl:inline">{s.short}</span>
              <span className="sr-only xl:hidden">{s.title}</span>
              <span aria-hidden className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full ${here ? "bg-text" : j < index ? "bg-text-3" : "bg-line"}`} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
