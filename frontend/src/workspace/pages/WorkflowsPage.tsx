import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipRow, DotIcon, Panel, SelectLike, Slider } from "../components";

export function WorkflowsPage() {
  const steps = ["Reddit Trending", "AI Script", "Voiceover", "Generate Video", "Publish"];
  return (
      <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-4 sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="font-display text-2xl font-bold">Workflow Builder</h1><p className="mt-1 text-sm text-c-text-muted">Trigger, action chain, config panel.</p></div><Button>Run now</Button></div>
          <div className="space-y-3">{steps.map((x, i) => <div key={x} className="flex items-center gap-3"><DotIcon label={String(i + 1)} tone={i % 2 ? "blue" : "rose"} /><div className="flex-1 rounded-xl border border-c-border bg-surface-2 p-4"><div className="font-semibold">{x}</div><div className="mt-1 text-xs text-c-text-muted">Configure inputs, retries, output mapping.</div></div>{i < steps.length - 1 ? <span className="text-c-text-muted">→</span> : null}</div>)}</div>
        </Card>
        <Card className="p-5"><h3 className="mb-4 text-sm font-semibold">Step settings</h3><div className="space-y-4"><Panel title="Minimum score"><Slider value="68" /></Panel><Panel title="Platforms"><ChipRow items={["TikTok", "Reels", "Shorts"]} active={["TikTok", "Reels"]} /></Panel><Panel title="Schedule"><SelectLike value="AI best time" /></Panel></div></Card>
      </div>
  );
}


