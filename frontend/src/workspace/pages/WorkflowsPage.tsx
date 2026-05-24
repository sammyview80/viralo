import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Shell } from "../Shell";
import { ChipRow, DotIcon, Panel, SelectLike, Slider } from "../components";

export function WorkflowsPage() {
  const steps = ["Reddit Trending", "AI Script", "Voiceover", "Generate Video", "Publish"];
  return (
    <Shell active="workflows">
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="p-6">
          <div className="mb-5 flex items-center justify-between"><div><h1 className="font-display text-2xl font-bold">Workflow Builder</h1><p className="mt-1 text-sm text-zinc-500">Trigger, action chain, config panel.</p></div><Button>Run now</Button></div>
          <div className="space-y-3">{steps.map((x, i) => <div key={x} className="flex items-center gap-3"><DotIcon label={String(i + 1)} tone={i % 2 ? "blue" : "rose"} /><div className="flex-1 rounded-xl border border-white/[.07] bg-white/[.035] p-4"><div className="font-semibold">{x}</div><div className="mt-1 text-xs text-zinc-500">Configure inputs, retries, output mapping.</div></div>{i < steps.length - 1 ? <span className="text-zinc-600">→</span> : null}</div>)}</div>
        </Card>
        <Card className="p-5"><h3 className="mb-4 text-sm font-semibold">Step settings</h3><div className="space-y-4"><Panel title="Minimum score"><Slider value="68" /></Panel><Panel title="Platforms"><ChipRow items={["TikTok", "Reels", "Shorts"]} active={["TikTok", "Reels"]} /></Panel><Panel title="Schedule"><SelectLike value="AI best time" /></Panel></div></Card>
      </div>
    </Shell>
  );
}
