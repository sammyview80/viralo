// Dependency-free SVG bar chart — see SimpleLineChart for why no charting lib.
import { useState } from "react";

const PALETTE = ["#ff3d6a", "#7c3aed", "#22c55e", "#f59e0b", "#38bdf8"];

export function SimpleBarChart({
  bars,
  height = 160,
}: {
  bars: { label: string; value: number }[];
  height?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 600;
  const padding = 24;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const gap = 12;
  const barWidth = bars.length ? (width - padding * 2 - gap * (bars.length - 1)) / bars.length : 0;

  const layout = bars.map((b, i) => {
    const barHeight = (b.value / max) * (height - padding * 2);
    const x = padding + i * (barWidth + gap);
    const y = height - padding - barHeight;
    return { ...b, x, y, barHeight };
  });
  const hovered = hoverIndex !== null ? layout[hoverIndex] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none" onMouseLeave={() => setHoverIndex(null)}>
        {layout.map((b, i) => {
          const baseColor = PALETTE[i % PALETTE.length];
          const isHovered = i === hoverIndex;
          return (
            <g key={b.label} onMouseEnter={() => setHoverIndex(i)}>
              {/* Invisible full-height hit target — a zero-value bar has
                  height 0 and would otherwise be impossible to hover. */}
              <rect
                x={b.x}
                y={padding}
                width={barWidth}
                height={height - padding * 2}
                fill="transparent"
              />
              <rect
                x={b.x}
                y={b.y}
                width={barWidth}
                height={b.barHeight}
                rx={4}
                fill={baseColor}
                opacity={isHovered ? 1 : 0.85}
                stroke={isHovered ? baseColor : "none"}
                strokeWidth={isHovered ? 2 : 0}
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[8px] border border-c-border bg-surface-1 px-2.5 py-1.5 text-[11px] text-c-text shadow-lg"
          style={{ left: `${((hovered.x + barWidth / 2) / width) * 100}%`, top: `${(hovered.y / height) * 100}%` }}
        >
          <div className="font-semibold">{hovered.value}</div>
          <div className="text-c-text-muted">{hovered.label}</div>
        </div>
      )}
    </div>
  );
}
