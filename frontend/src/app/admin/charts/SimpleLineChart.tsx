// Dependency-free SVG line chart — no charting lib in frontend/package.json,
// so avoid adding a heavy dependency for one sparkline-style trend graph.
export function SimpleLineChart({
  points,
  height = 160,
  color = "#ff3d6a",
}: {
  points: { label: string; value: number }[];
  height?: number;
  color?: string;
}) {
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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none">
      <path d={areaPath} fill={color} fillOpacity={0.08} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={2.5} fill={color}>
          <title>{`${c.label}: ${c.value}`}</title>
        </circle>
      ))}
    </svg>
  );
}
