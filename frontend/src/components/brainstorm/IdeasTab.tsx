import type { VideoIdea } from "@/lib/api";
import { IdeaCard } from "./IdeaCard";

export function IdeasTab({ ideas }: { ideas: VideoIdea[] }) {
  if (ideas.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-white/[.08] bg-white/[.015] p-8 text-center">
        <p className="text-[13px] font-bold text-zinc-300">No ideas yet</p>
        <p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-zinc-600">
          Ideas will appear here as agents finish. Check back in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">
          Ranked by virality score
        </p>
        <div className="flex gap-2">
          <span className="rounded-full border border-white/[.07] bg-black/20 px-3 py-1 text-[10px] text-zinc-500">{ideas.length} ideas</span>
          <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[.05] px-3 py-1 text-[10px] text-emerald-300">
            {ideas.filter(i => (i.virality_score ?? 0) >= 80).length} strong
          </span>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {ideas.map((idea, i) => (
          <IdeaCard key={`${idea.title}-${i}`} idea={idea} index={i} />
        ))}
      </div>
    </div>
  );
}
