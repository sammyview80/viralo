import { useEffect, useRef, useState, useCallback } from "react";
import { navigate } from "@/lib/router";
import { nav } from "../data";
import { searchApi, type SearchVideoHit, type SearchClipHit } from "@/lib/api";
import { Icons } from "@/components/icons";

// ── Public trigger ────────────────────────────────────────────────────────────
export function openCommandPalette() {
  window.dispatchEvent(new Event("viralo:open-cmdk"));
}

// ── Types ─────────────────────────────────────────────────────────────────────
type NavItem   = { kind: "nav";   label: string; href: string; icon: keyof typeof Icons; badge?: string };
type VideoItem = { kind: "video"; hit: SearchVideoHit };
type ClipItem  = { kind: "clip";  hit: SearchClipHit };
type Item = NavItem | VideoItem | ClipItem;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-c-text-muted";
  if (score >= 7) return "text-[#34d399]";
  if (score >= 4) return "text-[#fbbf24]";
  return "text-[#f87171]";
}

function statusColor(status: string): string {
  if (status === "ready" || status === "completed") return "text-[#34d399]";
  if (status === "processing" || status === "uploading") return "text-[#fbbf24]";
  if (status === "failed" || status === "error") return "text-[#f87171]";
  return "text-c-text-muted";
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CommandPalette() {
  const [open, setOpen]          = useState(false);
  const [query, setQuery]        = useState("");
  const [results, setResults]    = useState<{ videos: SearchVideoHit[]; clips: SearchClipHit[] } | null>(null);
  const [loading, setLoading]    = useState(false);
  const [activeIndex, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId    = useRef(0);

  const close = useCallback(() => { setOpen(false); setQuery(""); setResults(null); setActive(0); }, []);

  useEffect(() => {
    const onEvent = () => setOpen(o => !o);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(o => !o); }
      if (e.key === "Escape") close();
    };
    window.addEventListener("viralo:open-cmdk", onEvent);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("viralo:open-cmdk", onEvent); window.removeEventListener("keydown", onKey); };
  }, [close]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setResults(null); setLoading(false); return; }
    setLoading(true);
    const id = ++reqId.current;
    debounce.current = setTimeout(async () => {
      try {
        const data = await searchApi.global(query.trim());
        if (reqId.current === id) { setResults(data); setActive(0); }
      } catch { /* ignore */ }
      finally { if (reqId.current === id) setLoading(false); }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const navItems = query.trim()
    ? nav.filter(n => n.label.toLowerCase().includes(query.toLowerCase()))
    : nav;

  const items: Item[] = [
    ...navItems.map(n => ({ kind: "nav" as const, label: n.label, href: n.href, icon: n.icon, badge: n.badge })),
    ...(results?.videos ?? []).map(h => ({ kind: "video" as const, hit: h })),
    ...(results?.clips  ?? []).map(h => ({ kind: "clip"  as const, hit: h })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (i + 1) % Math.max(items.length, 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive(i => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1)); }
      if (e.key === "Enter" && items[activeIndex]) { e.preventDefault(); selectItem(items[activeIndex]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, activeIndex]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function selectItem(item: Item) {
    if (item.kind === "nav")   navigate(item.href);
    if (item.kind === "video") navigate(`/projects/${item.hit.id}`);
    if (item.kind === "clip")  navigate(`/projects/${item.hit.video_id}`);
    close();
  }

  if (!open) return null;

  const videoHits = results?.videos ?? [];
  const clipHits  = results?.clips  ?? [];

  return (
    <>
      <style>{`
        @keyframes cmdkIn {
          from { opacity: 0; transform: scale(.97) translateY(-6px); }
          to   { opacity: 1; transform: scale(1)   translateY(0); }
        }
        .cmdk-modal { animation: cmdkIn 130ms cubic-bezier(.16,1,.3,1) both; }
        .cmdk-row { border-left: 2px solid transparent; }
        .cmdk-row[data-active=true] { border-left-color: #ff3d6a; }
        .cmdk-scroll::-webkit-scrollbar { width: 3px; }
        .cmdk-scroll::-webkit-scrollbar-track { background: transparent; }
        .cmdk-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.07); border-radius: 2px; }
      `}</style>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 dark:bg-black/65 backdrop-blur-sm pt-[12vh]"
        onClick={close}
      >
        <div
          className="cmdk-modal w-full max-w-[560px] mx-4 rounded-xl border border-c-border bg-surface-1 shadow-[0_24px_64px_rgba(0,0,0,.65)] overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Brand accent line */}
          <div className="h-px bg-gradient-to-r from-[#ff3d6a]/70 via-[#ff7a3d]/25 to-transparent" />

          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-c-border">
            <Icons.Search size={15} className="shrink-0 text-c-text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search videos, workflows…"
              className="flex-1 bg-transparent text-sm text-c-text placeholder-c-text-muted outline-none"
            />
            {loading
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-c-border border-t-c-text-secondary shrink-0" />
              : <kbd className="rounded-md border border-c-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-c-text-muted font-mono">⌘K</kbd>
            }
          </div>

          {/* Results */}
          <div ref={listRef} className="cmdk-scroll max-h-[360px] overflow-y-auto py-1.5">
            {items.length === 0 && !loading && (
              <div className="px-4 py-8 text-center">
                <Icons.Search size={22} className="mx-auto mb-2.5 text-c-text-muted" />
                <p className="text-xs text-c-text-muted">
                  {query ? "No results found" : "Type to search videos and clips"}
                </p>
              </div>
            )}

            {/* Pages */}
            {navItems.length > 0 && (
              <Section label="Pages" count={navItems.length}>
                {items.map((item, idx) => {
                  if (item.kind !== "nav") return null;
                  const Icon = Icons[item.icon];
                  return (
                    <Row key={item.href} idx={idx} active={activeIndex === idx} onHover={() => setActive(idx)} onClick={() => selectItem(item)}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-c-text-muted">
                        {Icon && <Icon size={13} />}
                      </span>
                      <span className="flex-1 text-sm text-c-text">{item.label}</span>
                      {item.badge && (
                        <span className="rounded-full bg-[#ff3d6a]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#ff3d6a] uppercase tracking-wide">
                          {item.badge}
                        </span>
                      )}
                      <Icons.ChevronR size={12} className="shrink-0 text-c-text-muted" />
                    </Row>
                  );
                })}
              </Section>
            )}

            {/* Videos */}
            {videoHits.length > 0 && (
              <Section label="Videos" count={videoHits.length}>
                {items.map((item, idx) => item.kind !== "video" ? null : (
                  <Row key={item.hit.id} idx={idx} active={activeIndex === idx} onHover={() => setActive(idx)} onClick={() => selectItem(item)}>
                    <div className="relative h-9 w-[60px] shrink-0 overflow-hidden rounded-md bg-surface-2">
                      {item.hit.thumbnail_url
                        ? <img src={item.hit.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center"><Icons.Film size={14} className="text-c-text-muted" /></div>
                      }
                      {item.hit.duration_sec != null && (
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-px text-[8px] font-mono text-white leading-none">
                          {fmtDuration(item.hit.duration_sec)}
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm leading-tight text-c-text">{item.hit.title ?? "Untitled"}</span>
                      <span className={`text-[10px] capitalize ${statusColor(item.hit.status)}`}>{item.hit.status}</span>
                    </div>
                  </Row>
                ))}
              </Section>
            )}

            {/* Clips */}
            {clipHits.length > 0 && (
              <Section label="Clips" count={clipHits.length}>
                {items.map((item, idx) => item.kind !== "clip" ? null : (
                  <Row key={item.hit.id} idx={idx} active={activeIndex === idx} onHover={() => setActive(idx)} onClick={() => selectItem(item)}>
                    <div className="relative h-9 w-[60px] shrink-0 overflow-hidden rounded-md bg-surface-2">
                      {item.hit.thumbnail_url
                        ? <img src={item.hit.thumbnail_url} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center"><Icons.Film size={14} className="text-c-text-muted" /></div>
                      }
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm leading-tight text-c-text">{item.hit.title ?? "Untitled"}</span>
                      <span className={`text-[10px] capitalize ${statusColor(item.hit.status)}`}>{item.hit.status}</span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      {item.hit.score != null && (
                        <span className={`text-xs font-semibold tabular-nums ${scoreColor(item.hit.score)}`}>
                          {item.hit.score.toFixed(1)}
                        </span>
                      )}
                      {item.hit.platform && (
                        <span className="text-[9px] uppercase tracking-wide text-c-text-muted">{item.hit.platform}</span>
                      )}
                    </div>
                  </Row>
                ))}
              </Section>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 border-t border-c-border bg-surface-glass px-4 py-2">
            <span className="text-[10px] text-c-text-muted">↑↓ navigate</span>
            <span className="text-[10px] text-c-text-muted">↵ select</span>
            <span className="text-[10px] text-c-text-muted">Esc close</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 px-4 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-c-text-muted">{label}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-px text-[9px] tabular-nums text-c-text-muted">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ idx, active, onHover, onClick, children }: {
  idx: number; active: boolean; onHover: () => void; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      data-idx={idx}
      data-active={active}
      onMouseEnter={onHover}
      onClick={onClick}
      className={`cmdk-row flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${active ? "bg-surface-2" : "hover:bg-surface-1"}`}
    >
      {children}
    </button>
  );
}
