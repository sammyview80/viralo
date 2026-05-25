import { Card } from "@/components/ui/card";
import { Shell } from "../Shell";
import { DotIcon, HeroBlock } from "../components";

export function SettingsPage() {
  return (
    <Shell active="settings">
      <HeroBlock title="Settings" copy="Workspace profile, brand kit, team, billing, notifications, and API keys." />
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">{["Brand kit", "Team", "Billing", "Notifications", "API keys", "Security"].map((x, i) => <Card key={x} className="p-5"><DotIcon label={x.slice(0, 2).toUpperCase()} tone={i % 2 ? "blue" : "rose"} /><h3 className="mt-4 font-semibold">{x}</h3><p className="mt-2 text-sm text-zinc-500">Manage {x.toLowerCase()} preferences.</p></Card>)}</div>
    </Shell>
  );
}

