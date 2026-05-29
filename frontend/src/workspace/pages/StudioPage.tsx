import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { platforms } from "../data";
import { Shell } from "../Shell";
import { ChipRow, Panel, Phone, Ring, SelectLike } from "../components";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
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

  // Precision mode state
  const [precisionMode, setPrecisionMode] = useState(false);

  // YouTube tab state
  const [urlVal, setUrlVal]       = useState("");
  const [urlReady, setUrlReady]   = useState(false);
  const [ytMeta, setYtMeta]       = useState<{ title: string; thumbnail: string } | null>(null);
  const [ytMetaLoading, setYtMetaLoading] = useState(false);

  // Read query params on mount — ?type=youtube&url=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("type") === "youtube") {
      const u = params.get("url") || "";
      if (u) { setTab("url"); setUrlVal(u); }
    }
  }, []);

  useEffect(() => {
    if (!urlVal.trim()) { setUrlReady(false); setYtMeta(null); return; }
    const t = setTimeout(async () => {
      const valid = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/.test(urlVal.trim());
      setUrlReady(valid);
      if (!valid) { setUploadError("Enter a valid YouTube URL"); setYtMeta(null); return; }
      setUploadError("");
      // Fetch oEmbed metadata for preview
      setYtMetaLoading(true);
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(urlVal.trim())}&format=json`);
        if (r.ok) {
          const d = await r.json();
          const vidId = urlVal.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1] ?? "";
          setYtMeta({
            title: d.title || "",
            thumbnail: vidId ? `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg` : (d.thumbnail_url || ""),
          });
        }
      } catch { /* non-fatal */ }
      finally { setYtMetaLoading(false); }
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
      const effectiveConfig: ClipConfig = precisionMode
        ? { ...clipConfig, precision_mode: true }
        : clipConfig;
      const video = await videoApi.youtube(urlVal.trim(), undefined, effectiveConfig);
      startProcessing(video);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Import failed");
      setUploading(false);
    }
  }, [urlVal, clipConfig, precisionMode]);

  const isUploadTab = tab === "upload" || tab === "url";

  return (
    <Shell active="studio">
      <div className="flex flex-col overflow-hidden rounded-[22px] border border-white/[.08] bg-[#0e1420] shadow-[0_28px_90px_rgba(0,0,0,.28)]">
        {/* ── Workspace header ── */}
        <div className="flex min-w-0 flex-col border-b border-white/[.07]">
          <div className="relative overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,61,106,.18),transparent_31%),radial-gradient(circle_at_88%_0%,rgba(59,130,246,.10),transparent_28%)]" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <Badge className="mb-2 rounded-full border-[#ff3d6a]/20 bg-[#ff3d6a]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#ff7a9a]">
                  Creator workspace
                </Badge>
                <h1 className="font-display text-[26px] font-bold tracking-[-.02em] text-white sm:text-[30px]">Video Studio</h1>
                <p className="mt-1.5 max-w-xl text-[13px] leading-6 text-zinc-400">Import long-form videos, extract the highest-retention moments, and format them for every short-form channel.</p>
              </div>
              <div className="grid gap-2 text-[11.5px] font-semibold text-zinc-400 sm:grid-cols-3 lg:min-w-[430px]">
                {["Analyze transcript", "Find hooks", "Export platform-ready"].map((step, index) => (
                  <Card key={step} className="rounded-[13px] border-white/[.07] bg-white/[.035] px-3 py-2.5">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-zinc-600">Step {index + 1}</span>
                    <span className="text-zinc-300">{step}</span>
                  </Card>
                ))}
              </div>
            </div>
            <div className="relative mt-5 grid max-w-[560px] grid-cols-1 rounded-[14px] border border-white/[.08] bg-[#090e17]/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,.04)] sm:grid-cols-3">
              {([["ai", "✦ AI Generate"], ["upload", "↑ Upload"], ["url", "↗ YouTube URL"]] as [StudioTab, string][]).map(([id, label]) => (
                <button key={id} onClick={() => { setTab(id); setUploadError(""); }}
                  className={cn(
                    "flex-1 rounded-[11px] px-3 py-2.5 text-xs font-bold transition",
                    tab === id ? "bg-[#ff3d6a] text-white shadow-[0_10px_26px_rgba(255,61,106,.32)]" : "text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200"
                  )}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
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
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <Card className="overflow-hidden rounded-[22px] border-white/[.08] bg-[#0b111a] shadow-[0_20px_70px_rgba(0,0,0,.22)]">
                  <CardHeader className="border-b border-white/[.07] bg-[radial-gradient(circle_at_8%_0%,rgba(248,113,113,.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015))] p-5 sm:p-6">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] border border-red-400/25 bg-red-400/[.10] shadow-[0_10px_30px_rgba(248,113,113,.12)]">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="#f87171"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.28 8.28 0 0 0 4.84 1.56V6.79a4.85 4.85 0 0 1-1.07-.1z"/></svg>
                      </div>
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <CardTitle className="font-display text-[21px] font-bold tracking-[-.01em] text-white">Import from YouTube</CardTitle>
                          <Badge variant="ready" className="rounded-full px-2.5 py-1 text-[11px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Public links only
                          </Badge>
                        </div>
                        <p className="max-w-2xl text-[13px] leading-6 text-zinc-400">Paste a video or Shorts URL, verify the source, then tune the clip recipe below. The primary action stays at the top so users always know where to begin.</p>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4 p-5 sm:p-6">
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px]">
                      <div className="relative min-w-0">
                        <Input
                          value={urlVal} onChange={(e) => setUrlVal(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && urlReady && !uploading && handleUrlFetch()}
                          placeholder="https://youtube.com/watch?v=…"
                          aria-label="YouTube video URL"
                          className="h-[52px] rounded-[14px] border-white/[.09] bg-[#090f18] pr-24 text-[13px] font-medium placeholder:text-zinc-600"
                        />
                        <Badge className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full border-white/[.07] bg-white/[.04] px-2 py-1 text-[10.5px] font-bold text-zinc-500 sm:inline-flex">YouTube</Badge>
                      </div>
                      <Button
                        disabled={!urlReady || uploading}
                        onClick={handleUrlFetch}
                        className="h-[52px] rounded-[14px] px-6 text-[13px] sm:min-w-[150px]"
                      >
                        {uploading
                          ? <span className="mx-auto block h-4 w-4 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
                          : "Import & Clip"}
                      </Button>
                    </div>

                    {/* Precision Mode toggle */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-zinc-400">Clip mode</span>
                        <div className="flex rounded-[10px] border border-white/[.07] bg-[#090f18] p-0.5">
                          <button
                            onClick={() => setPrecisionMode(false)}
                            className={cn(
                              "rounded-[8px] px-3 py-1.5 text-[11.5px] font-bold transition",
                              !precisionMode ? "bg-[#ff3d6a] text-white shadow-[0_4px_14px_rgba(255,61,106,.32)]" : "text-zinc-500 hover:text-zinc-300"
                            )}
                          >
                            Multi Clip
                          </button>
                          <button
                            onClick={() => setPrecisionMode(true)}
                            className={cn(
                              "rounded-[8px] px-3 py-1.5 text-[11.5px] font-bold transition",
                              precisionMode ? "bg-[#ff3d6a] text-white shadow-[0_4px_14px_rgba(255,61,106,.32)]" : "text-zinc-500 hover:text-zinc-300"
                            )}
                          >
                            Best Viral Clip
                          </button>
                        </div>
                      </div>
                      {precisionMode && (
                        <p className="text-[11px] font-medium text-[#ff7a9a]">Targeting 1 clip at 9.5+ virality score</p>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        ["1", "Paste URL", "Public YouTube or Shorts link"],
                        ["2", "Preview source", "Metadata confirms the right video"],
                        ["3", "Tune recipe", "Choose platforms, score, length"],
                      ].map(([num, title, desc]) => (
                        <Card key={title} className="rounded-[14px] border-white/[.07] bg-white/[.025] p-3">
                          <div className="flex items-center gap-2 text-[12px] font-bold text-zinc-200">
                            <span className="grid h-6 w-6 place-items-center rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[10px] text-[#ff6c90]">{num}</span>
                            {title}
                          </div>
                          <p className="mt-1.5 text-[11px] leading-4 text-zinc-500">{desc}</p>
                        </Card>
                      ))}
                    </div>

                    {urlReady && !uploading && (
                      ytMetaLoading ? (
                        <Card className="flex items-center gap-3 rounded-[16px] border-white/[.07] bg-white/[.035] p-3">
                          <Skeleton className="h-20 w-32 flex-shrink-0 rounded-[11px] bg-zinc-800" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-3 w-3/4 rounded bg-zinc-800" />
                            <Skeleton className="h-2.5 w-1/3 rounded bg-zinc-800/60" />
                          </div>
                        </Card>
                      ) : ytMeta ? (
                        <Card className="flex flex-col gap-3 rounded-[16px] border-emerald-400/18 bg-emerald-400/[.055] p-3 sm:flex-row sm:items-center">
                          <div className="relative h-24 w-full flex-shrink-0 overflow-hidden rounded-[12px] bg-zinc-800 sm:h-20 sm:w-36">
                            <img src={ytMeta.thumbnail} alt={ytMeta.title} className="h-full w-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 shadow-lg">
                                <svg viewBox="0 0 24 24" fill="white" className="ml-0.5 h-4 w-4"><path d="M8 5v14l11-7z"/></svg>
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <Badge variant="ready" className="mb-1.5 rounded-full border-0 bg-emerald-400/10 px-2 py-1 text-[10.5px] font-bold uppercase tracking-[.08em] text-emerald-300">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                              Ready to import
                            </Badge>
                            <p className="line-clamp-2 text-[13px] font-bold leading-snug text-white">{ytMeta.title}</p>
                            <p className="mt-1 text-[11.5px] text-zinc-500">Preview verified through YouTube metadata.</p>
                          </div>
                        </Card>
                      ) : (
                        <Alert className="rounded-[13px] border-emerald-300/15 bg-emerald-400/[.08] px-3 py-2.5 text-emerald-300">
                          <AlertDescription className="flex items-center gap-2 text-[12px] font-semibold">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                            Valid YouTube video detected — ready to import
                          </AlertDescription>
                        </Alert>
                      )
                    )}
                    {uploadError && (
                      <Alert variant="destructive" className="rounded-[13px] border-red-400/20 bg-red-400/[.07] px-3 py-2.5 text-red-400">
                        <AlertDescription className="text-[12px] font-medium">{uploadError}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-[22px] border-white/[.08] bg-[#0b111a] p-4 shadow-[0_20px_70px_rgba(0,0,0,.18)]">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="font-display text-[15px] font-bold text-white">What happens next</h4>
                    <Badge className="rounded-full border-white/[.08] bg-white/[.04] px-2 py-1 text-[10.5px] font-bold text-zinc-500">~2–5 min</Badge>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["01", "Transcript analysis", "Finds topics, speaker turns, and punchy sentences."],
                      ["02", "Hook scoring", "Ranks moments by retention, emotion, and clarity."],
                      ["03", "Clip packaging", "Applies ratio, quality, captions, and platform rules."],
                    ].map(([num, title, desc]) => (
                      <Card key={num} className="rounded-[14px] border-white/[.07] bg-white/[.03] p-3">
                        <div className="flex items-center gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-full border border-[#ff3d6a]/25 bg-[#ff3d6a]/10 text-[10.5px] font-bold text-[#ff6c90]">{num}</span>
                          <span className="text-[12.5px] font-bold text-zinc-200">{title}</span>
                        </div>
                        <p className="mt-2 text-[11.5px] leading-5 text-zinc-500">{desc}</p>
                      </Card>
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: preview (AI) or clip settings (upload/url) ── */}
        {isUploadTab ? (
          <div className="p-4 sm:p-5">
            <ClipConfigPanel config={clipConfig} onChange={setClipConfig} />
          </div>
        ) : (
          <div className="flex min-h-[520px] flex-col bg-[#0b101a] sm:min-h-[620px]">
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

