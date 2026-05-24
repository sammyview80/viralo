import { Card } from "@/components/ui/card";
import { Shell } from "../Shell";
import { HeroBlock } from "../components";

export function SchedulerPage() {
  const days = Array.from({ length: 35 }, (_, i) => i + 1);
  return (
    <Shell active="scheduler">
      <HeroBlock title="Social Scheduler" copy="Calendar queue with platform chips, captions, time slots, and approval state." />
      <Card className="p-5"><div className="grid grid-cols-7 gap-2">{days.map((d) => <div key={d} className="min-h-28 rounded-xl border border-white/[.06] bg-white/[.02] p-2"><div className="text-xs text-zinc-600">{d <= 31 ? d : ""}</div>{[5, 8, 12, 15, 22, 26].includes(d) ? <div className="mt-3 rounded-lg bg-[#ff3d6a]/15 p-2 text-[11px] text-rose-200">TikTok 09:00</div> : null}</div>)}</div></Card>
    </Shell>
  );
}
