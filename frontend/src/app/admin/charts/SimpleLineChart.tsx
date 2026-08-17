// Dependency-free SVG line chart — no charting lib in frontend/package.json,
// so avoid adding a heavy dependency for one sparkline-style trend graph.
import { useState } from "react";

export function SimpleLineChart({
  points,
  height = 160,
  color = "#ff3d6a",
}: {
  points: { label: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 600;
  const padding = 24;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (p.value / max) * (height - padding * 2);
    return { x, y, ...p };
  });

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${coords[coords.length - 1]?.x ?? padding},${height - padding} L${padding},${height - padding} Z`;
  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <path d={areaPath} fill={color} fillOpacity={0.08} stroke="none" />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hovered && (
          <line x1={hovered.x} y1={padding} x2={hovered.x} y2={height - padding} stroke={color} strokeOpacity={0.25} strokeWidth={1} />
        )}
        {coords.map((c, i) => (
          <g key={i}>
            {/* Wide invisible hit target — the visible dot (r=2.5) is too small to hover reliably */}
            <rect
              x={c.x - stepX / 2}
              y={0}
              width={stepX || width}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
            />
            <circle
              cx={c.x}
              cy={c.y}
              r={i === hoverIndex ? 5 : 2.5}
              fill={i === hoverIndex ? "#fff" : color}
              stroke={color}
              strokeWidth={i === hoverIndex ? 2 : 0}
            />
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-[8px] border border-c-border bg-surface-1 px-2.5 py-1.5 text-[11px] text-c-text shadow-lg"
          style={{ left: `${(hovered.x / width) * 100}%`, top: `${(hovered.y / height) * 100}%` }}
        >
          <div className="font-semibold">{hovered.value}</div>
          <div className="text-c-text-muted">{hovered.label}</div>
        </div>
      )}
    </div>
  );
}
