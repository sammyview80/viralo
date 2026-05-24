import { Shell } from "../Shell";
import { HeroBlock, Trend } from "../components";

export function TrendingPage() {
  return (
    <Shell active="trending">
      <HeroBlock title="Trending" copy="Track viral audio, competitor clips, hashtags, and emerging hooks." />
      <div className="grid gap-4 lg:grid-cols-3">{["Morning routine reset", "AI workflow stack", "Creator desk setup", "Unpopular fitness truth", "60-second teardown", "3 habits challenge"].map((x, i) => <Trend key={x} title={x} score={95 - i * 6} />)}</div>
    </Shell>
  );
}
