const EXAMPLE_TOPICS = ["AI fitness coach", "Street food Nepal", "Solo travel tips", "Budget skincare"];

export function EmptyState({ onPickExample }: { onPickExample: (topic: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="rounded-[24px] border border-white/[.07] bg-gradient-to-br from-white/[.055] to-white/[.015] p-6 shadow-2xl shadow-black/20">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 px-3 py-1 text-[11px] font-bold text-rose-200">
          ✦ AI content strategy room
        </div>
        <h2 className="max-w-2xl text-[28px] font-black leading-tight tracking-tight text-white sm:text-[34px]">
          Turn a niche into clear, ranked video ideas.
        </h2>
        <p className="mt-3 max-w-2xl text-[13px] leading-6 text-zinc-500">
          Seven agents scan live viral signals, trends, competitors, audience angles, monetization fit, and content formats, then synthesize a verdict with 10 video ideas you can expand.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[["7", "specialized agents"], ["10", "ranked video ideas"], ["1", "niche verdict"]].map(([value, label]) => (
            <div key={label} className="rounded-[16px] border border-white/[.06] bg-black/20 p-4">
              <p className="text-[24px] font-black text-white">{value}</p>
              <p className="mt-1 text-[11px] text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">What you get</p>
          <div className="mt-4 space-y-3">
            {[
              ["Trend read", "Formats, hooks, and momentum signals for the niche."],
              ["Market map", "Creator gaps and competitor angles worth attacking."],
              ["Idea stack", "Titles, hooks, format, estimated views, and virality score."],
            ].map(([title, copy]) => (
              <div key={title} className="flex gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#ff3d6a]" />
                <div>
                  <p className="text-[12px] font-bold text-zinc-200">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-zinc-600">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-[20px] border border-white/[.07] bg-white/[.02] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Try a topic</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLE_TOPICS.map(example => (
              <button
                key={example}
                onClick={() => onPickExample(example)}
                className="rounded-full border border-white/[.08] bg-white/[.03] px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition hover:border-[#ff3d6a]/35 hover:bg-[#ff3d6a]/10 hover:text-rose-100"
              >
                {example}
              </button>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-zinc-600">
            Tip: use a focused niche like "meal prep for busy nurses" instead of a broad category like "food".
          </p>
        </section>
      </div>
    </div>
  );
}
