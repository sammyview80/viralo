import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Breakpoint = { minWidth: number; columns: number };

type VirtualRange = {
  start: number;
  end: number;
  before: number;
  after: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Walk up the DOM to find the nearest ancestor that actually scrolls (overflow-y auto/scroll).
 *  The app's page content scrolls inside <main className="overflow-y-auto"> (see Shell.tsx),
 *  not the window — so virtualization must track that element's scroll, not just window's.
 */
function findScrollParent(node: HTMLElement | null): HTMLElement | Window {
  let el = node?.parentElement ?? null;
  while (el) {
    const style = window.getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return window;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => setWidth(node.getBoundingClientRect().width);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return { ref, width };
}

function useVirtualRange(total: number, estimateSize: number, overscan = 4): [React.RefObject<HTMLDivElement | null>, VirtualRange] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [range, setRange] = useState<VirtualRange>(() => ({ start: 0, end: Math.min(total, 12), before: 0, after: 0 }));

  const updateRange = useCallback(() => {
    const node = ref.current;
    if (!node || total === 0) {
      setRange({ start: 0, end: 0, before: 0, after: 0 });
      return;
    }

    const rect = node.getBoundingClientRect();
    const totalHeight = total * estimateSize;
    const visibleTop = Math.max(0, -rect.top);
    const scrollParent = findScrollParent(node);
    const viewportHeight = scrollParent instanceof Window
      ? window.innerHeight
      : scrollParent.getBoundingClientRect().height;
    const visibleBottom = Math.min(totalHeight, Math.max(0, viewportHeight - rect.top));
    const first = clamp(Math.floor(visibleTop / estimateSize) - overscan, 0, Math.max(0, total - 1));
    const last = clamp(Math.ceil(visibleBottom / estimateSize) + overscan, first + 1, total);

    setRange({
      start: first,
      end: last,
      before: first * estimateSize,
      after: Math.max(0, (total - last) * estimateSize),
    });
  }, [estimateSize, overscan, total]);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateRange();
      });
    };

    updateRange();
    const scrollParent = findScrollParent(ref.current);
    scrollParent.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    const observer = new ResizeObserver(schedule);
    if (ref.current) observer.observe(ref.current);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      scrollParent.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [updateRange]);

  return [ref, range];
}

function getColumns(width: number, breakpoints: Breakpoint[], fallback: number) {
  if (width <= 0) return fallback;
  return breakpoints.reduce((cols, bp) => (width >= bp.minWidth ? bp.columns : cols), 1);
}

export function VirtualizedGrid<T>({
  items,
  keyForItem,
  renderItem,
  estimateRowHeight = 430,
  gap = 16,
  overscan = 3,
  columns = [
    { minWidth: 768, columns: 2 },
    { minWidth: 1536, columns: 3 },
  ],
  className,
}: {
  items: T[];
  keyForItem: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateRowHeight?: number;
  gap?: number;
  overscan?: number;
  columns?: Breakpoint[];
  className?: string;
}) {
  const { ref: widthRef, width } = useElementWidth<HTMLDivElement>();
  const columnCount = getColumns(width, columns, 1);
  const rows = Math.ceil(items.length / columnCount);
  const rowSize = estimateRowHeight + gap;
  const [virtualRef, range] = useVirtualRange(rows, rowSize, overscan);

  const visibleRows = useMemo(() => {
    const out: Array<{ rowIndex: number; rowItems: Array<{ item: T; index: number }> }> = [];
    for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
      const start = rowIndex * columnCount;
      const rowItems = items.slice(start, start + columnCount).map((item, offset) => ({ item, index: start + offset }));
      if (rowItems.length > 0) out.push({ rowIndex, rowItems });
    }
    return out;
  }, [columnCount, items, range.end, range.start]);

  return (
    <div ref={widthRef} className={cn("w-full", className)}>
      <div ref={virtualRef}>
        <div style={{ height: range.before }} />
        <div className="space-y-4">
          {visibleRows.map(({ rowIndex, rowItems }) => (
            <div key={rowIndex} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
              {rowItems.map(({ item, index }) => (
                <div key={keyForItem(item, index)}>{renderItem(item, index)}</div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ height: range.after }} />
      </div>
    </div>
  );
}

export function VirtualizedList<T>({
  items,
  keyForItem,
  renderItem,
  estimateRowHeight = 96,
  overscan = 8,
  className,
}: {
  items: T[];
  keyForItem: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateRowHeight?: number;
  overscan?: number;
  className?: string;
}) {
  const [virtualRef, range] = useVirtualRange(items.length, estimateRowHeight, overscan);
  const visibleItems = items.slice(range.start, range.end);

  return (
    <div ref={virtualRef} className={className}>
      <div style={{ height: range.before }} />
      {visibleItems.map((item, offset) => {
        const index = range.start + offset;
        return <div key={keyForItem(item, index)}>{renderItem(item, index)}</div>;
      })}
      <div style={{ height: range.after }} />
    </div>
  );
}
