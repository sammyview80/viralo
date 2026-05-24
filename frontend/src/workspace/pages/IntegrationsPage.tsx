import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Shell } from "../Shell";
import { DotIcon, HeroBlock } from "../components";

export function IntegrationsPage() {
  const items = ["TikTok", "Instagram", "YouTube", "Slack", "Notion", "Zapier", "Cloudinary", "S3"];
  return (
    <Shell active="integrations">
      <HeroBlock title="Integrations" copy="Connect channels, storage, automations, webhooks, and publishing APIs." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{items.map((x, i) => <Card key={x} className="p-5"><DotIcon label={x.slice(0, 2).toUpperCase()} tone={i % 2 ? "blue" : "rose"} /><h3 className="mt-4 font-semibold">{x}</h3><p className="mt-2 text-sm text-zinc-500">OAuth, scopes, webhook sync.</p><Badge className="mt-4" variant={i < 3 ? "ready" : "muted"}>{i < 3 ? "Connected" : "Available"}</Badge></Card>)}</div>
    </Shell>
  );
}
