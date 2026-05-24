import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { platforms } from "../data";
import { Shell } from "../Shell";
import { ChipRow, Panel, Phone, Ring, SelectLike, UploadZone, UrlImport } from "../components";

export function StudioPage() {
  const [tab, setTab] = useState("ai");
  const [tone, setTone] = useState("Strong hook");
  const [prompt, setPrompt] = useState("Create a high-retention TikTok about 5 morning habits that changed my life.");

  return (
    <Shell active="studio">
      <div className="grid min-h-[calc(100vh-116px)] overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 border-b border-white/[.07] xl:border-b-0 xl:border-r">
          <div className="px-6 pt-6">
            <h1 className="font-display text-[22px] font-bold tracking-[-.01em]">Video Studio</h1>
            <p className="mt-1 text-[13px] text-zinc-500">Turn any idea into a viral short video in minutes.</p>
            <div className="mt-5 flex max-w-[440px] rounded-[12px] border border-white/[.07] bg-[#141926] p-1">
              {[["ai", "✦ AI Generate"], ["upload", "↑ Upload"], ["url", "↗ YouTube URL"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={cn("flex-1 rounded-[9px] px-3 py-2 text-xs font-semibold transition", tab === id ? "bg-[#ff3d6a] text-white shadow-[0_6px_18px_rgba(255,61,106,.32)]" : "text-zinc-500 hover:text-zinc-200")}>{label}</button>
              ))}
            </div>
          </div>
          <div className="p-6">
            {tab === "ai" ? (
              <div className="space-y-5">
                <div>
                  <label className="text-[12px] font-semibold text-zinc-400">What's your video about?</label>
                  <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-2 min-h-[138px] w-full resize-y rounded-[12px] border border-white/[.07] bg-[#1b2233] p-4 text-[13px] leading-7 text-zinc-100 outline-none transition focus:border-[#ff3d6a]/50 focus:ring-4 focus:ring-[#ff3d6a]/10" placeholder="e.g. 5 morning habits that completely changed my productivity and mental health..." />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Panel title="Platforms"><ChipRow items={platforms.map((p) => p[1])} active={["TikTok", "Reels"]} /></Panel>
                  <Panel title="Duration"><ChipRow items={["30s", "60s", "90s"]} active={["60s"]} /></Panel>
                  <Panel title="Voice"><SelectLike value="Alex (energetic)" /></Panel>
                  <Panel title="Captions"><ChipRow items={["Word", "Line", "None"]} active={["Word"]} /></Panel>
                </div>
                <div>
                  <label className="text-[12px] font-semibold text-zinc-400">Content style</label>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    {["⚡ Strong hook", "📖 Storytelling", "🎓 Educational", "🔥 Controversial", "😂 Humorous", "✨ Inspiring"].map((x) => {
                      const clean = x.replace(/^.. /, "");
                      return <button key={x} onClick={() => setTone(clean)} className={cn("rounded-[10px] border p-3 text-left text-[12.5px] font-semibold transition", tone === clean ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-white" : "border-white/[.07] bg-[#141926] text-zinc-400 hover:border-white/[.13]")}>{x}</button>;
                    })}
                  </div>
                </div>
                <Button className="h-11 w-full rounded-[12px]" size="default">✦ Generate Video</Button>
                <Button className="w-full justify-center" variant="ghost" size="sm">▣ View Clips Library</Button>
              </div>
            ) : tab === "upload" ? <UploadZone compact /> : <UrlImport />}
          </div>
        </div>
        <div className="flex min-h-[620px] flex-col bg-[#0b101a]">
          <div className="flex h-[53px] items-center gap-2 border-b border-white/[.07] px-5">
            <span className="font-display text-[13px] font-bold">Preview</span>
            <span className="text-[11.5px] text-zinc-500">{prompt.trim() ? "— estimated" : "— enter a prompt"}</span>
            <a href="/clips" className="ml-auto rounded-lg border border-white/[.07] px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-white/[.04]">▣ All clips</a>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6">
            <Phone label={prompt.trim() ? tone : "Enter a topic"} />
            {prompt.trim() ? (
              <>
                <div className="grid w-full grid-cols-[56px_1fr] items-center gap-3 rounded-[12px] border border-white/[.07] bg-[#141926] p-3">
                  <Ring value={prompt.length > 30 ? 62 : 41} />
                  <div><h4 className="text-[13px] font-semibold">Estimated virality</h4><p className="mt-1 text-xs leading-5 text-zinc-500">{prompt.length > 30 ? "Good topic. Try a stronger hook for +10 pts." : "Add more detail for a better estimate."}</p></div>
                </div>
                <div className="w-full">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">Script preview</div>
                  <div className="rounded-[12px] border border-white/[.07] bg-[#141926] p-3">
                    {["[HOOK] 5 morning habits that changed...", "[BUILD] Here's exactly what changed when I started doing this every morning.", "[CTA] Save this. Your future self will thank you."].map((line, i) => <p key={line} className={cn("text-xs leading-5", i === 0 ? "text-zinc-100" : "text-zinc-400")}>{line}</p>)}
                  </div>
                </div>
              </>
            ) : <p className="max-w-[210px] text-center text-[12.5px] leading-6 text-zinc-500">Enter a topic on the left and your video preview will appear here.</p>}
          </div>
        </div>
      </div>
    </Shell>
  );
}
