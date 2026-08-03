import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  settingsApi,
  billingApi,
  type WorkspaceInfo,
  type BrandKit,
  type NotificationPrefs,
  type ApiKeyInfo,
  type SubscriptionInfo,
  type UserResponse,
} from "@/lib/api";

/* ─── Nav sections ──────────────────────────────────────────────────────── */

const SECTIONS = [
  { id: "profile",       label: "Profile",       icon: <IconProfile />,      desc: "Your name and avatar." },
  { id: "workspace",     label: "Workspace",    icon: <IconWorkspace />,    desc: "Name, URL, and timezone for your workspace." },
  { id: "brand",         label: "Brand kit",    icon: <IconBrand />,        desc: "Colors and font applied to exported clips." },
  { id: "billing",       label: "Billing",       icon: <IconBilling />,      desc: "Plan and usage." },
  { id: "notifications", label: "Notifications", icon: <IconNotifications />,desc: "Choose what Viralo alerts you about." },
  { id: "api",           label: "API keys",      icon: <IconApi />,          desc: "Keys for accessing the Viralo API programmatically." },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

/* ─── Icons ─────────────────────────────────────────────────────────────── */

function IconProfile() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[15px] h-[15px]"><circle cx="8" cy="5.5" r="2.5"/><path d="M2.5 13.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg>;
}
function IconWorkspace() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[15px] h-[15px]"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>;
}
function IconBrand() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[15px] h-[15px]"><circle cx="8" cy="8" r="5"/><path d="M8 3v10M3 8h10"/></svg>;
}
function IconBilling() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[15px] h-[15px]"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 6.5h13"/><path d="M4.5 9.5h2"/></svg>;
}
function IconNotifications() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[15px] h-[15px]"><path d="M8 2a4.5 4.5 0 014.5 4.5c0 2.5.5 4 1.5 5H2c1-1 1.5-2.5 1.5-5A4.5 4.5 0 018 2z"/><path d="M6.5 13.5a1.5 1.5 0 003 0"/></svg>;
}
function IconApi() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-[15px] h-[15px]"><path d="M2 8h3M11 8h3M5 5l-2 3 2 3M11 5l2 3-2 3"/></svg>;
}

/* ─── Primitives ─────────────────────────────────────────────────────────── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-10 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]/40",
        checked ? "bg-[#ff3d6a]" : "bg-surface-3"
      )}
    >
      <span className={cn(
        "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all duration-200",
        checked ? "left-[22px]" : "left-[3px]"
      )} />
    </button>
  );
}

function FieldRow({
  label, hint, children, border = true,
}: {
  label: string; hint?: string; children: React.ReactNode; border?: boolean;
}) {
  return (
    <div className={cn(
      "flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5",
      border && "border-b border-c-border last:border-0"
    )}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-c-text">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-c-text-muted">{hint}</p>}
      </div>
      <div className="shrink-0 w-full sm:w-auto">{children}</div>
    </div>
  );
}

function TextInput({ placeholder, value, onChange, mono, className }: {
  placeholder?: string; value?: string; onChange?: (v: string) => void;
  mono?: boolean; className?: string;
}) {
  return (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={e => onChange?.(e.target.value)}
      className={cn(
        "h-8 rounded-[8px] border border-c-border bg-surface-1 px-3 text-[13px] text-c-text placeholder:text-c-text-muted",
        "transition-colors focus:border-[#ff3d6a]/50 focus:outline-none focus:ring-1 focus:ring-[#ff3d6a]/20",
        mono && "font-mono text-xs tracking-tight",
        className
      )}
    />
  );
}

function OutlineBtn({ children, onClick, disabled }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 cursor-pointer rounded-[8px] border border-c-border px-3 text-[13px] font-medium text-c-text-muted transition-colors hover:border-c-border-hover hover:text-c-text disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PrimaryBtn({ children, onClick, disabled, className }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 cursor-pointer rounded-[8px] bg-[#ff3d6a] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#e8304f] active:scale-[.98] disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-c-border bg-surface-1">
      {children}
    </div>
  );
}

function FieldSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Card>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-4 border-b border-c-border last:border-0">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32 bg-surface-glass" />
            <Skeleton className="h-3 w-48 bg-surface-glass" />
          </div>
          <Skeleton className="h-8 w-24 rounded-[8px] bg-surface-glass" />
        </div>
      ))}
    </Card>
  );
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="pt-3">
      <PrimaryBtn onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </PrimaryBtn>
    </div>
  );
}

/* ─── Profile ────────────────────────────────────────────────────────────── */

function ProfileSection() {
  const [data, setData] = useState<UserResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { settingsApi.getMe().then(setData).catch(() => {}); }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const updated = await settingsApi.updateMe({
        full_name: data.full_name ?? undefined,
        avatar_url: undefined,
      });
      setData(updated);
    } finally { setSaving(false); }
  };

  if (!data) return <FieldSkeleton rows={2} />;

  return (
    <div className="space-y-3">
      <Card>
        <FieldRow label="Full name" hint="Shown across the workspace.">
          <TextInput
            value={data.full_name ?? ""}
            onChange={v => setData(d => d && { ...d, full_name: v })}
            placeholder="Your name"
            className="w-full sm:w-48"
          />
        </FieldRow>
        <FieldRow label="Email" hint="Login email — cannot be changed here." border={false}>
          <span className="text-[13px] text-c-text-muted">{data.email}</span>
        </FieldRow>
      </Card>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

/* ─── Workspace ──────────────────────────────────────────────────────────── */

function WorkspaceSection() {
  const [data, setData] = useState<WorkspaceInfo | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { settingsApi.getWorkspace().then(setData).catch(() => {}); }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try { await settingsApi.updateWorkspace({ display_name: data.display_name, timezone: data.timezone }); }
    finally { setSaving(false); }
  };

  if (!data) return <FieldSkeleton rows={3} />;

  return (
    <div className="space-y-3">
      <Card>
        <FieldRow label="Workspace name" hint="Shown in the top bar and on exported content.">
          <TextInput value={data.display_name} onChange={v => setData(d => d && { ...d, display_name: v })} className="w-full sm:w-48" />
        </FieldRow>
        <FieldRow label="Workspace URL" hint="Used for sharing links.">
          <div className="flex h-8 w-full items-center rounded-[8px] border border-c-border bg-surface-1 px-3 transition-colors focus-within:border-[#ff3d6a]/50 sm:w-auto">
            <span className="text-[12px] text-c-text-muted select-none">viralo.co/</span>
            <input
              defaultValue={data.subdomain}
              className="w-full bg-transparent text-[13px] text-c-text focus:outline-none sm:w-28"
            />
          </div>
        </FieldRow>
        <FieldRow label="Timezone" hint="Used for scheduling and analytics reports." border={false}>
          <div className="relative">
            <select
              value={data.timezone}
              onChange={e => setData(d => d && { ...d, timezone: e.target.value })}
              className="h-8 cursor-pointer appearance-none rounded-[8px] border border-c-border bg-surface-1 pl-3 pr-8 text-[13px] text-c-text focus:border-[#ff3d6a]/50 focus:outline-none"
            >
              {["UTC","America/New_York","America/Los_Angeles","Europe/London","Asia/Kolkata","Asia/Singapore","Asia/Tokyo"].map(tz => (
                <option key={tz} value={tz}>{tz.replace("_", " ")}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-c-text-muted text-[10px]">▾</span>
          </div>
        </FieldRow>
      </Card>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

/* ─── Brand kit ──────────────────────────────────────────────────────────── */

function BrandSection() {
  const [data, setData] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { settingsApi.getBrandKit().then(setData).catch(() => {}); }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await settingsApi.updateBrandKit(data);
      const root = document.documentElement;
      if (data.primary_color) root.style.setProperty("--brand", data.primary_color);
      if (data.font) root.style.setProperty("--brand-font", data.font);
    } finally { setSaving(false); }
  };

  if (!data) return <FieldSkeleton rows={3} />;

  return (
    <div className="space-y-3">
      <Card>
        <FieldRow label="Primary color" hint="Used on exported clips, thumbnails, and overlays.">
          <div className="flex w-full items-center gap-2.5 sm:w-auto">
            <div className="h-7 w-7 rounded-[6px] border border-c-border" style={{ background: data.primary_color }} />
            <TextInput mono value={data.primary_color} onChange={v => setData(d => d && { ...d, primary_color: v })} className="w-full sm:w-24" />
          </div>
        </FieldRow>
        <FieldRow label="Secondary color" hint="Used for backgrounds and secondary elements.">
          <div className="flex w-full items-center gap-2.5 sm:w-auto">
            <div className="h-7 w-7 rounded-[6px] border border-c-border" style={{ background: data.secondary_color }} />
            <TextInput mono value={data.secondary_color} onChange={v => setData(d => d && { ...d, secondary_color: v })} className="w-full sm:w-24" />
          </div>
        </FieldRow>
        <FieldRow label="Default font" hint="Applied to text overlays in exported clips." border={false}>
          <div className="relative">
            <select
              value={data.font}
              onChange={e => setData(d => d && { ...d, font: e.target.value })}
              className="h-8 cursor-pointer appearance-none rounded-[8px] border border-c-border bg-surface-1 pl-3 pr-8 text-[13px] text-c-text focus:border-[#ff3d6a]/50 focus:outline-none"
            >
              {["Inter","Geist","DM Sans","Sora","Poppins"].map(f => <option key={f}>{f}</option>)}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-c-text-muted text-[10px]">▾</span>
          </div>
        </FieldRow>
      </Card>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

/* ─── Billing ────────────────────────────────────────────────────────────── */

function BillingSection() {
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);

  useEffect(() => { billingApi.subscription().then(setSub).catch(() => {}); }, []);

  const storageGB = sub ? Math.round((sub.storage_bytes_used ?? 0) / 1e9 * 10) / 10 : 0;

  const usageRows = [
    { label: "Videos processed", used: sub?.videos_used ?? 0,    total: 100, suffix: "" },
    { label: "Storage",          used: storageGB,                  total: 50,  suffix: " GB" },
    { label: "Brainstorm",       used: sub?.brainstorm_used ?? 0, total: 30,  suffix: "" },
  ];

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-5 sm:py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-c-text-muted mb-1">Current plan</p>
          {sub ? (
            <>
              <p className="text-xl font-bold capitalize text-c-text tracking-tight">{sub.plan_name}</p>
              {sub.current_period_end && (
                <p className="mt-0.5 text-[12px] text-c-text-muted">
                  Renews {new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
            </>
          ) : (
            <Skeleton className="mt-1 h-6 w-16 bg-surface-glass" />
          )}
        </div>
        <OutlineBtn>Manage plan</OutlineBtn>
      </div>

      <div className="border-t border-c-border px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-c-text-muted mb-4">Usage this period</p>
        <div className="space-y-3.5">
          {usageRows.map(({ label, used, total, suffix }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[13px] text-c-text-secondary">{label}</p>
                <p className="tabular-nums text-[12px] text-c-text-muted">{used}{suffix}<span className="text-c-text-muted opacity-50"> / {total}{suffix}</span></p>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min((used / total) * 100, 100)}%`,
                    background: used / total > 0.85 ? "#f97316" : "#ff3d6a",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ─── Notifications ──────────────────────────────────────────────────────── */

const NOTIF_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: "uploads_complete", label: "Upload complete",  hint: "When a video finishes processing." },
  { key: "clip_ready",       label: "Clip ready",       hint: "When a clip is ready to review or publish." },
  { key: "team_activity",    label: "Team activity",    hint: "When teammates make changes to shared projects." },
  { key: "weekly_digest",    label: "Weekly digest",    hint: "Performance summary every Monday." },
  { key: "billing_alerts",   label: "Billing alerts",   hint: "Invoices, renewals, and payment failures." },
  { key: "product_updates",  label: "Product updates",  hint: "New features and release notes." },
];

function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  useEffect(() => { settingsApi.getNotificationPrefs().then(setPrefs).catch(() => {}); }, []);

  const toggle = async (key: keyof NotificationPrefs) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    await settingsApi.updateNotificationPrefs({ [key]: updated[key] }).catch(() => setPrefs(prefs));
  };

  if (!prefs) return <FieldSkeleton rows={6} />;

  return (
    <Card>
      {NOTIF_ROWS.map(({ key, label, hint }) => (
        <FieldRow key={key} label={label} hint={hint}>
          <Toggle checked={prefs[key]} onChange={() => toggle(key)} />
        </FieldRow>
      ))}
    </Card>
  );
}

/* ─── API keys ───────────────────────────────────────────────────────────── */

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = () => settingsApi.listApiKeys().then(setKeys).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const created = await settingsApi.createApiKey(newKeyName.trim());
      setRevealedKey(created.key);
      setNewKeyName("");
      load();
    } finally { setCreating(false); }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await settingsApi.revokeApiKey(id);
      setKeys(prev => prev?.filter(k => k.id !== id) ?? null);
      setRevealedKey(null);
    } finally { setRevoking(null); }
  };

  return (
    <div className="space-y-3">
      {revealedKey && (
        <div className="rounded-[10px] border border-emerald-800/40 bg-emerald-950/20 p-4">
          <p className="mb-2.5 text-[12px] font-semibold text-emerald-400">Copy this key — it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12px] text-emerald-600 dark:text-emerald-300">
              {revealedKey}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedKey); setRevealedKey(null); }}
              className="shrink-0 h-8 cursor-pointer rounded-[8px] border border-emerald-800/40 bg-emerald-950/30 px-3 text-[12px] font-medium text-emerald-400 transition hover:bg-emerald-950/50"
            >
              Copy & close
            </button>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-2 px-4 py-4 border-b border-c-border sm:flex-row sm:items-end sm:gap-2 sm:px-5">
          <div className="flex-1">
            <p className="mb-1.5 text-[12px] text-c-text-muted">Key name</p>
            <TextInput placeholder="e.g. Production" value={newKeyName} onChange={setNewKeyName} className="w-full" />
          </div>
          <PrimaryBtn onClick={create} disabled={creating || !newKeyName.trim()} className="w-full sm:w-auto">
            {creating ? "Generating…" : "Generate key"}
          </PrimaryBtn>
        </div>

        {keys === null ? (
          <div className="px-5 py-4"><Skeleton className="h-12 rounded-[8px] bg-surface-glass" /></div>
        ) : keys.length === 0 ? (
          <p className="px-5 py-6 text-center text-[13px] text-c-text-muted">No API keys yet.</p>
        ) : (
          keys.map(k => (
            <div key={k.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-c-border last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-c-text">{k.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-c-text-muted">{k.key_prefix}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <p className="text-[12px] text-c-text-muted">{new Date(k.created_at).toLocaleDateString()}</p>
                <button
                  onClick={() => revoke(k.id)}
                  disabled={revoking === k.id}
                  className="cursor-pointer text-[12px] text-red-500/60 transition hover:text-red-400 disabled:opacity-40"
                >
                  {revoking === k.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      <p className="text-[12px] text-c-text-muted">Never share API keys in client-side code or public repos — they grant full workspace access.</p>
    </div>
  );
}

/* ─── Section content map ────────────────────────────────────────────────── */

const CONTENT: Record<SectionId, React.ReactNode> = {
  profile:       <ProfileSection />,
  workspace:     <WorkspaceSection />,
  brand:         <BrandSection />,
  billing:       <BillingSection />,
  notifications: <NotificationsSection />,
  api:           <ApiKeysSection />,
};

/* ─── Page ───────────────────────────────────────────────────────────────── */

export function SettingsPage() {
  const [active, setActive] = useState<SectionId>("profile");
  const section = SECTIONS.find(s => s.id === active)!;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[12px] border border-c-border sm:flex-row sm:min-h-[calc(100dvh-116px)]">

      {/* Sidebar */}
      <nav className="hidden w-[200px] shrink-0 flex-col border-r border-c-border bg-surface-1 p-2 sm:flex">
        <p className="px-2.5 pt-3 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-c-text-muted">Settings</p>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              "relative mb-0.5 flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-[8px] px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
              active === s.id
                ? "bg-surface-glass text-c-text before:absolute before:left-[-8px] before:top-2.5 before:bottom-2.5 before:w-[2.5px] before:rounded-r before:bg-[#ff3d6a]"
                : "text-c-text-muted hover:bg-surface-2 hover:text-c-text"
            )}
          >
            <span className={cn("shrink-0 transition-opacity", active === s.id ? "opacity-100" : "opacity-60")}>
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      {/* Mobile strip */}
      <div className="sm:hidden w-full border-b border-c-border bg-surface-1 flex overflow-x-auto snap-x snap-mandatory gap-0.5 p-1.5">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              "relative shrink-0 snap-start cursor-pointer rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors",
              active === s.id
                ? "bg-surface-glass text-c-text before:absolute before:left-1.5 before:top-1.5 before:bottom-1.5 before:w-[2.5px] before:rounded-r before:bg-[#ff3d6a]"
                : "text-c-text-muted hover:text-c-text"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-surface-0">
        {/* Section header */}
        <div className="border-b border-c-border px-4 py-4 sm:px-7 sm:py-5">
          <div className="flex items-center gap-2.5 mb-0.5">
            <span className="text-[#ff3d6a]">{section.icon}</span>
            <h1 className="text-[15px] font-semibold text-c-text">{section.label}</h1>
          </div>
          <p className="text-[13px] text-c-text-muted">{section.desc}</p>
        </div>

        {/* Section body */}
        <div className="px-4 py-5 sm:px-7 sm:py-6">
          {CONTENT[active]}
        </div>
      </div>
    </div>
  );
}
