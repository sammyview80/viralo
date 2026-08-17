// Dependency-free SVG bar chart — see SimpleLineChart for why no charting lib.
const PALETTE = ["#ff3d6a", "#7c3aed", "#22c55e", "#f59e0b", "#38bdf8"];

export function SimpleBarChart({
  bars,
  height = 160,
}: {
  bars: { label: string; value: number }[];
  height?: number;
}) {
  const width = 600;
  const padding = 24;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const gap = 12;
  const barWidth = bars.length ? (width - padding * 2 - gap * (bars.length - 1)) / bars.length : 0;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none">
      {bars.map((b, i) => {
        const barHeight = (b.value / max) * (height - padding * 2);
        const x = padding + i * (barWidth + gap);
        const y = height - padding - barHeight;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={4} fill={PALETTE[i % PALETTE.length]}>
              <title>{`${b.label}: ${b.value}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
