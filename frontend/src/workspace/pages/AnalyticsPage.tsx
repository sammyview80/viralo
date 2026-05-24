import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Shell } from "../Shell";
import { Bars } from "../components";

export function AnalyticsPage() {
  return (
    <Shell active="analytics">
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="p-6"><div className="mb-5 flex items-center justify-between"><h1 className="font-display text-2xl font-bold">Analytics</h1><Button variant="secondary">Export</Button></div><Bars tall /><div className="mt-5 grid gap-3 md:grid-cols-3">{["1.8M views", "91K followers", "6.8% engagement"].map((x) => <div key={x} className="rounded-[10px] border border-white/[.06] bg-white/[.025] p-4 font-semibold">{x}</div>)}</div></Card>
        <Card className="p-5"><h3 className="mb-4 text-sm font-semibold">Funnel</h3><div className="space-y-3">{["Impressions 1.8M", "Views 482K", "Likes 38K", "Follows 3.8K"].map((x, i) => <div key={x}><div className="mb-2 flex justify-between text-xs"><span>{x}</span><span>{100 - i * 22}%</span></div><div className="h-2 rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[#ff3d6a]" style={{ width: `${100 - i * 22}%` }} /></div></div>)}</div></Card>
      </div>
    </Shell>
  );
}
