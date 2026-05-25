import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { platforms } from "../data";
import { Shell } from "../Shell";
import { ChipRow, Panel, Phone, Ring, SelectLike } from "../components";
import { Button } from "@/components/ui/button";
import { navigate } from "@/lib/router";
import { videoApi, type ClipConfig, type VideoResponse } from "@/lib/api";
import { ClipConfigPanel, DEFAULT_CONFIG } from "./UploadPage";

type StudioTab = "ai" | "upload" | "url";

export function StudioPage() {
  const [tab, setTab] = useState<StudioTab>("ai");
  const [tone, setTone] = useState("Strong hook");
  const [prompt, setPrompt] = useState("Create a high-retention TikTok about 5 morning habits that changed my life.");
  const [clipConfig, setClipConfig] = useState<ClipConfig>(DEFAULT_CONFIG);

  // Upload tab state
  const [drag, setDrag]               = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // YouTube tab state
  const [urlVal, setUrlVal]     = useState("");
  const [urlReady, setUrlReady] = useState(false);

  useEffect(() => {
    if (!urlVal.trim()) { setUrlReady(false); return; }
    const t = setTimeout(() => {
      const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/.test(urlVal.trim());
      setUrlReady(valid);
      if (!valid) setUploadError("Enter a valid YouTube URL");
      else setUploadError("");
    }, 600);
    return () => clearTimeout(t);
  }, [urlVal]);

  const startProcessing = (video: VideoResponse) => {
    navigate(`/projects/${video.id}`);
  };

  const handleFile = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.upload(file, file.name.replace(/\.[^.]+$/, ""), clipConfig);
      startProcessing(video);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    }
  }, [clipConfig]);

  const handleUrlFetch = useCallback(async () => {
    if (!urlVal.trim()) return;
    setUploading(true);
    setUploadError("");
    try {
      const video = await videoApi.youtube(urlVal.trim(), undefined, clipConfig);
      startProcessing(video);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Import failed");
      setUploading(false);
    }
  }, [urlVal, clipConfig]);

  const isUploadTab = tab === "upload" || tab === "url";

  return (
    <Shell active="studio">
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-white/[.07] bg-[#0e1420]">
        {/* ── Left panel ── */}
        <div className="flex min-w-0 flex-col border-b border-white/[.07]">
          <div className="px-6 pt-6">
            <h1 className="font-display text-[22px] font-bold tracking-[-.01em]">Video Studio</h1>
            <p className="mt-1 text-[13px] text-zinc-500">Turn any idea into a viral short video in minutes.</p>
            <div className="mt-5 flex max-w-[440px] rounded-[12px] border border-white/[.07] bg-[#141926] p-1">
              {([["ai", "✦ AI Generate"], ["upload", "↑ Upload"], ["url", "↗ YouTube URL"]] as [StudioTab, string][]).map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); setUploadError(""); }}
                  className={cn(
                    "flex-1 rounded-[9px] px-3 py-2 text-xs font-semibold transition",
                    tab === id ? "bg-[#ff3d6a] text-white shadow-[0_6px_18px_rgba(255,61,106,.32)]" : "text-zinc-500 hover:text-zinc-200"
                  )}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {/* ── AI Generate ── */}
            {tab === "ai" && (
              <div className="space-y-5">
                <div>
                  <label className="text-[12px] font-semibold text-zinc-400">What's your video about?</label>
                  <textarea
                    value={prompt} onChange={(e) => setPrompt(e.target.value)}
                    className="mt-2 min-h-[138px] w-full resize-y rounded-[12px] border border-white/[.07] bg-[#1b2233] p-4 text-[13px] leading-7 text-zinc-100 outline-none transition focus:border-[#ff3d6a]/50 focus:ring-4 focus:ring-[#ff3d6a]/10"
                    placeholder="e.g. 5 morning habits that completely changed my productivity…"
                  />
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
                      return (
                        <button key={x} onClick={() => setTone(clean)}
                          className={cn(
                            "rounded-[10px] border p-3 text-left text-[12.5px] font-semibold transition",
                            tone === clean ? "border-[#ff3d6a]/40 bg-[#ff3d6a]/10 text-white" : "border-white/[.07] bg-[#141926] text-zinc-400 hover:border-white/[.13]"
                          )}>
                          {x}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button className="h-11 w-full rounded-[12px]" size="default">✦ Generate Video</Button>
              </div>
            )}

            {/* ── Upload file ── */}
            {tab === "upload" && (
              <div className="flex flex-col gap-4">
                <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => handleFile(e.target.files)} />
                <div
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files); }}
                  className={cn(
                    "flex min-h-[280px] flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-[18px] border-2 border-dashed p-10 text-center transition",
                    uploading  ? "cursor-default border-[#ff3d6a]/40 bg-[#ff3d6a]/[.03]"
                    : drag     ? "border-[#ff3d6a]/60 bg-[#ff3d6a]/[.06] scale-[1.01]"
                    : "border-white/[.09] bg-white/[.015] hover:border-white/20 hover:bg-white/[.03]"
                  )}>
                  {uploading ? (
                    <>
                      <span className="block h-12 w-12 rounded-full border-[3px] border-[#ff3d6a]/30 border-t-[#ff3d6a] animate-spin" />
                      <div>
                        <p className="font-display text-xl font-bold text-white">Uploading…</p>
                        <p className="mt-1 text-[13px] text-zinc-500">Transferring your video to Viralo</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid h-16 w-16 place-items-center rounded-[20px] border border-[#ff3d6a]/20 bg-[#ff3d6a]/[.08]">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ff7a9a" strokeWidth={1.8}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      </div>
                      <div>
                        <p className="font-display text-2xl font-bold text-white">{drag ? "Drop to upload" : "Drop video here"}</p>
                        <p className="mt-1.5 text-[13px] text-zinc-500">MP4, MOV, WebM, MKV, AVI · up to 4 GB</p>
                      </div>
                      <button className="rounded-[11px] border border-white/[.1] bg-white/[.06] px-6 py-2.5 text-[13px] font-bold text-zinc-200 transition hover:bg-white/[.10] hover:text-white">
                        Browse files
                      </button>
                    </>
                  )}
                </div>
                {uploadError && (
                  <div className="flex items-center gap-2.5 rounded-[11px] border border-red-400/20 bg-red-400/[.07] px-4 py-3 text-[12.5px] font-medium text-red-400">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {uploadError}
                  </div>
                )}
              </div>
            )}

            {/* ── YouTube URL ── */}
            {tab === "url" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 rounded-[18px] border border-white/[.08] bg-white/[.02] p-6">
                  <div className="mb-2 grid h-14 w-14 place-items-center rounded-[18px] border border-red-400/20 bg-red-400/[.08]">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#f87171"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
                  </div>
                  <h3 className="font-display text-xl font-bold text-white">Import from YouTube</h3>
                  <p className="text-[13px] text-zinc-500">Paste a public YouTube URL to generate clips from it.</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={urlVal} onChange={(e) => setUrlVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && urlReady && !uploading && handleUrlFetch()}
                      placeholder="https://youtube.com/watch?v=…"
                      className="min-w-0 flex-1 rounded-[11px] border border-white/[.08] bg-white/[.04] px-4 py-3 text-[13px] font-medium text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-[#ff3d6a]/50"
                    />
                    <button
                      disabled={!urlReady || uploading}
                      onClick={handleUrlFetch}
                      className="rounded-[11px] bg-[#ff3d6a] px-6 py-3 text-[13px] font-bold text-white transition hover:bg-[#e8304f] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {uploading
                        ? <span className="block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                        : "Import & Clip"}
                    </button>
                  </div>
                  {urlReady && !uploading && (
                    <div className="flex items-center gap-2 rounded-[10px] border border-emerald-300/15 bg-emerald-400/[.08] px-3 py-2.5 text-[12px] font-semibold text-emerald-300">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                      YouTube video detected — ready to import
                    </div>
                  )}
                  {uploadError && (
                    <div className="flex items-center gap-2 rounded-[10px] border border-red-400/20 bg-red-400/[.07] px-3 py-2.5 text-[12px] font-medium text-red-400">
                      {uploadError}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: preview (AI) or clip settings (upload/url) ── */}
        {isUploadTab ? (
          <div className="p-5">
            <ClipConfigPanel config={clipConfig} onChange={setClipConfig} />
          </div>
        ) : (
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
                    <div>
                      <h4 className="text-[13px] font-semibold">Estimated virality</h4>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{prompt.length > 30 ? "Good topic. Try a stronger hook for +10 pts." : "Add more detail for a better estimate."}</p>
                    </div>
                  </div>
                  <div className="w-full">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">Script preview</div>
                    <div className="rounded-[12px] border border-white/[.07] bg-[#141926] p-3">
                      {["[HOOK] 5 morning habits that changed...", "[BUILD] Here's exactly what changed when I started doing this every morning.", "[CTA] Save this. Your future self will thank you."].map((line, i) => (
                        <p key={line} className={cn("text-xs leading-5", i === 0 ? "text-zinc-100" : "text-zinc-400")}>{line}</p>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="max-w-[210px] text-center text-[12.5px] leading-6 text-zinc-500">Enter a topic on the left and your video preview will appear here.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
