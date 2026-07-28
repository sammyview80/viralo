import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import { seriesApi, type Series, type SeriesOptions, type SeriesVideo } from "@/lib/api";
import { FALLBACK_OPTIONS } from "./series-create/constants";

function SeriesCard({ s, options, onChanged, onDeleted }: {
  s: Series; options: SeriesOptions;
  onChanged: (s: Series) => void; onDeleted: (id: string) => void;
}) {
  const [videos, setVideos] = useState<SeriesVideo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || videos !== null) return;
    seriesApi.videos(s.id).then(setVideos).catch(() => setVideos([]));
  }, [open, videos, s.id]);

  const nicheLabel = options.niches.find((n) => n.id === s.niche)?.label ?? s.niche;

  return (
    <div className="rounded-[14px] border border-c-border bg-surface-1">
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-c-text">{s.name}</p>
          <p className="text-[11.5px] text-c-text-muted">
            {nicheLabel} · {s.art_style} · {s.cadence.replace("_", " ")} at {s.publish_time} UTC
            {s.next_run_at && s.is_active && <> · next gen {new Date(s.next_run_at).toLocaleString()}</>}
          </p>
        </div>
        <button type="button" disabled={busy}
          onClick={async () => { setBusy(true); try { await seriesApi.generateNow(s.id); setVideos(null); } finally { setBusy(false); } }}
          className="cursor-pointer rounded-[9px] border border-c-border px-3 py-1.5 text-[11.5px] font-semibold text-c-text-muted transition hover:text-c-text disabled:opacity-50">
          {busy ? "Queued…" : "Generate now"}
        </button>
        <button
          type="button"
          onClick={async () => { const upd = await seriesApi.update(s.id, { is_active: !s.is_active }); onChanged(upd); }}
          className={cn("relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors", s.is_active ? "bg-[#ff3d6a]" : "bg-surface-3")}
          title={s.is_active ? "Pause series" : "Resume series"}
        >
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]", s.is_active ? "left-[calc(100%-22px)]" : "left-0.5")} />
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] border border-c-border text-c-text-muted hover:text-c-text">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
            className={cn("transition-transform", open && "rotate-180")}><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button type="button"
          onClick={async () => { if (confirm(`Delete series "${s.name}"? Generated videos are kept.`)) { await seriesApi.remove(s.id); onDeleted(s.id); } }}
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] border border-c-border text-c-text-muted transition hover:border-red-400/40 hover:text-red-400">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-c-border p-4">
          {videos === null ? (
            <p className="text-[12px] text-c-text-muted">Loading videos…</p>
          ) : videos.length === 0 ? (
            <p className="text-[12px] text-c-text-muted">No videos generated yet — the first one arrives before the next publish slot.</p>
          ) : (
            <div className="grid gap-2">
              {videos.map((v) => (
                <div key={v.id} className="flex items-center gap-3 rounded-[10px] border border-c-border bg-surface-2 p-2.5">
                  {(v.clip_thumb || v.thumbnail_url) && (
                    <img src={v.clip_thumb || v.thumbnail_url || ""} alt="" className="h-14 w-9 rounded-[6px] object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-c-text">{v.title || "Untitled"}</p>
                    <p className="text-[11px] text-c-text-muted">{v.status}{v.created_at ? ` · ${new Date(v.created_at).toLocaleString()}` : ""}</p>
                  </div>
                  {v.storage_url && (
                    <a href={v.storage_url} target="_blank" rel="noreferrer"
                      className="rounded-[8px] border border-c-border px-2.5 py-1 text-[11px] font-semibold text-c-text-muted hover:text-c-text">Watch</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SeriesPage() {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [options, setOptions] = useState<SeriesOptions>(FALLBACK_OPTIONS);

  useEffect(() => {
    seriesApi.list().then(setSeries).catch(() => setSeries([]));
    seriesApi.options().then(setOptions).catch(() => null);
  }, []);

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[20px] font-bold text-c-text">Series</h1>
          <p className="text-[12.5px] text-c-text-muted">Faceless videos generated and posted on autopilot.</p>
        </div>
        <Button onClick={() => navigate("/series/create")}
          className="rounded-[11px] bg-gradient-to-r from-[#ff3d6a] to-[#ff7a3d] px-4 text-[13px] font-bold text-white">
          + Create Series
        </Button>
      </div>

      {series === null ? (
        <p className="py-16 text-center text-[12.5px] text-c-text-muted">Loading…</p>
      ) : series.length === 0 ? (
        <div className="grid place-items-center rounded-[14px] border border-dashed border-c-border py-20 text-center">
          <p className="text-[13px] font-semibold text-c-text-muted">No series yet. Create your first automated video series!</p>
          <Button onClick={() => navigate("/series/create")} className="mt-4 rounded-[11px] bg-[#ff3d6a] px-4 text-[13px] font-bold text-white">
            Create Series
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {series.map((s) => (
            <SeriesCard key={s.id} s={s} options={options}
              onChanged={(upd) => setSeries((list) => (list ?? []).map((x) => (x.id === upd.id ? upd : x)))}
              onDeleted={(id) => setSeries((list) => (list ?? []).filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}
