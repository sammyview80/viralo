import { Card } from "@/components/ui/card";
import { Shell } from "../Shell";
import { Agent, HeroBlock, Idea } from "../components";

export function BrainstormPage() {
  return (
    <Shell active="brainstorm">
      <HeroBlock title="Brainstorm Room" copy="Five AI agents research angles, hooks, audience objections, monetization, and content formats." />
      <div className="grid gap-4 lg:grid-cols-5">{["Trend", "Audience", "Hook", "Content", "Monetize"].map((x, i) => <Agent key={x} name={x} active={i < 3} />)}</div>
      <Card className="p-5"><h3 className="mb-4 text-sm font-semibold">Generated ideas</h3><div className="grid gap-3 md:grid-cols-2">{["The morning habit nobody tracks", "Why consistency is a content moat", "Steal this $0 creator setup", "Hooks that die in first 2 seconds"].map((x) => <Idea key={x} title={x} />)}</div></Card>
    </Shell>
  );
}
