import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
} from "@/lib/api";

const SECTIONS = [
  { id: "workspace",     label: "Workspace",      icon: "◈", desc: "Name, URL, logo, and timezone for your workspace." },
  { id: "brand",         label: "Brand kit",      icon: "⬡", desc: "Colors, fonts, and watermarks applied to exported clips." },
  { id: "team",          label: "Team",            icon: "⬢", desc: "Manage members and access roles." },
  { id: "billing",       label: "Billing",         icon: "◉", desc: "Plan, usage, and payment method." },
  { id: "notifications", label: "Notifications",   icon: "◎", desc: "Choose what Viralo emails and alerts you about." },
  { id: "api",           label: "API keys",        icon: "⋈", desc: "Keys for accessing the Viralo API programmatically." },
  { id: "security",      label: "Security",        icon: "⬟", desc: "Password, two-factor authentication, and active sessions." },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d6a]/50",
        checked ? "bg-[#ff3d6a]" : "bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-8 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-200">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TextInput({ placeholder, value, onChange, className }: {
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={e => onChange?.(e.target.value)}
      className={cn(
        "h-9 rounded-lg border border-white/[.08] bg-white/[.03] px-3 text-sm text-zinc-200 placeholder-zinc-600 transition focus:border-[#ff3d6a]/40 focus:bg-white/[.05] focus:outline-none",
        className
      )}
    />
  );
}

function SaveBar({ onSave, saving }: { onSave: () => void; saving: boolean }) {
  return (
    <div className="pt-4">
      <Button
        onClick={onSave}
        disabled={saving}
        className="h-9 cursor-pointer rounded-lg bg-[#ff3d6a] px-5 text-sm font-semibold text-white hover:bg-[#e8304f] disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────────

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
    <div className="divide-y divide-white/[.05]">
      <FieldRow label="Workspace name" hint="Appears in the top bar and on exported content.">
        <TextInput value={data.display_name} onChange={v => setData(d => d && { ...d, display_name: v })} className="w-52" />
      </FieldRow>
      <FieldRow label="Workspace URL" hint="Used for sharing links and team invites.">
        <div className="flex h-9 items-center gap-1 rounded-lg border border-white/[.08] bg-white/[.03] px-3">
          <span className="text-xs text-zinc-600">viralo.co/</span>
          <span className="text-sm text-zinc-200">{data.subdomain}</span>
        </div>
      </FieldRow>
      <FieldRow label="Timezone" hint="Used for scheduling and analytics reporting.">
        <select
          value={data.timezone}
          onChange={e => setData(d => d && { ...d, timezone: e.target.value })}
          className="h-9 cursor-pointer appearance-none rounded-lg border border-white/[.08] bg-[#0d1520] px-3 pr-7 text-sm text-zinc-300 focus:border-[#ff3d6a]/40 focus:outline-none"
        >
          {["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo"].map(tz => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </FieldRow>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

// ── Brand kit ────────────────────────────────────────────────────────────────

function BrandSection() {
  const [data, setData] = useState<BrandKit | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { settingsApi.getBrandKit().then(setData).catch(() => {}); }, []);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try { await settingsApi.updateBrandKit(data); }
    finally { setSaving(false); }
  };

  if (!data) return <FieldSkeleton rows={3} />;

  return (
    <div className="divide-y divide-white/[.05]">
      <FieldRow label="Primary color" hint="Used on exported clips, thumbnails, and overlays.">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md border border-white/[.08]" style={{ background: data.primary_color }} />
          <TextInput value={data.primary_color} onChange={v => setData(d => d && { ...d, primary_color: v })} className="w-24 font-mono text-xs" />
        </div>
      </FieldRow>
      <FieldRow label="Secondary color" hint="Used for backgrounds and secondary UI elements.">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md border border-white/[.08]" style={{ background: data.secondary_color }} />
          <TextInput value={data.secondary_color} onChange={v => setData(d => d && { ...d, secondary_color: v })} className="w-24 font-mono text-xs" />
        </div>
      </FieldRow>
      <FieldRow label="Default font" hint="Applied to text overlays in exported clips.">
        <select
          value={data.font}
          onChange={e => setData(d => d && { ...d, font: e.target.value })}
          className="h-9 cursor-pointer rounded-lg border border-white/[.08] bg-[#0d1520] px-3 text-sm text-zinc-300 focus:outline-none"
        >
          {["Inter", "Geist", "DM Sans", "Sora", "Poppins"].map(f => <option key={f}>{f}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Watermark" hint="Overlay applied to exported video clips.">
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/[.06] bg-white/[.025] px-2.5 py-1 text-xs text-zinc-500">
            {data.watermark_url ? "Uploaded" : "None"}
          </span>
          <button className="h-9 cursor-pointer rounded-lg border border-white/[.08] bg-white/[.03] px-3 text-xs font-medium text-zinc-400 transition hover:border-white/[.15] hover:text-zinc-200">
            Upload
          </button>
        </div>
      </FieldRow>
      <SaveBar onSave={save} saving={saving} />
    </div>
  );
}

// ── Team ─────────────────────────────────────────────────────────────────────

function TeamSection() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => { settingsApi.getWorkspace().then(setWorkspace).catch(() => {}); }, []);

  const initials = workspace?.display_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() ?? "??";

  return (
    <div className="space-y-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">1 member</p>
        <button className="h-8 cursor-pointer rounded-lg bg-[#ff3d6a] px-4 text-xs font-semibold text-white transition hover:bg-[#e8304f]">
          Invite member
        </button>
      </div>
      <div className="space-y-2">
        {workspace ? (
          <div className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#ff3d6a]/20 bg-[#ff3d6a]/10 text-xs font-bold text-[#ff3d6a]">{initials}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-200">{workspace.display_name}</p>
              <p className="text-xs text-zinc-500">{workspace.subdomain}</p>
            </div>
            <Badge variant="ready" className="text-[10px]">Owner</Badge>
          </div>
        ) : (
          <Skeleton className="h-16 w-full rounded-xl bg-white/[.04]" />
        )}
      </div>
      <Separator className="bg-white/[.05]" />
      <div>
        <p className="mb-2 text-sm font-medium text-zinc-200">Invite by email</p>
        <div className="flex gap-2">
          <TextInput placeholder="colleague@email.com" value={inviteEmail} onChange={setInviteEmail} className="flex-1" />
          <button className="h-9 cursor-pointer rounded-lg border border-white/[.08] bg-white/[.03] px-4 text-xs font-medium text-zinc-400 transition hover:border-white/[.15] hover:text-zinc-200">
            Send invite
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Billing ──────────────────────────────────────────────────────────────────

function BillingSection() {
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);

  useEffect(() => { billingApi.subscription().then(setSub).catch(() => {}); }, []);

  const storageGB = sub ? Math.round((sub.storage_bytes_used ?? 0) / 1e9 * 10) / 10 : 0;

  return (
    <div className="space-y-5 py-4">
      {sub ? (
        <div className="relative overflow-hidden rounded-xl border border-[#ff3d6a]/20 bg-[#ff3d6a]/5 p-5">
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-[#ff3d6a]/60 to-transparent" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#ff3d6a]">Current plan</p>
              <p className="mt-1 text-xl font-black capitalize text-white">{sub.plan_name}</p>
              {sub.current_period_end && (
                <p className="mt-0.5 text-sm text-zinc-400">
                  Renews {new Date(sub.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
            </div>
            <button className="h-9 cursor-pointer rounded-lg border border-white/[.08] bg-white/[.03] px-4 text-xs font-medium text-zinc-400 transition hover:border-white/[.15] hover:text-zinc-200">
              Manage plan
            </button>
          </div>
        </div>
      ) : (
        <Skeleton className="h-28 w-full rounded-xl bg-white/[.04]" />
      )}

      <div className="divide-y divide-white/[.05]">
        {[
          { label: "Videos processed", used: sub?.videos_used ?? 0,  total: 100,  suffix: "" },
          { label: "Storage used",      used: storageGB,               total: 50,   suffix: " GB" },
          { label: "Brainstorm sessions",used: sub?.brainstorm_used ?? 0, total: 30, suffix: "" },
        ].map(({ label, used, total, suffix }) => (
          <div key={label} className="py-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm text-zinc-300">{label}</p>
              <p className="tabular-nums text-xs text-zinc-500">{used}{suffix} / {total}{suffix}</p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.05]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#ff3d6a] to-rose-400 transition-all"
                style={{ width: `${Math.min((used / total) * 100, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

const NOTIF_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: "uploads_complete", label: "Upload complete",  hint: "When a video finishes processing." },
  { key: "clip_ready",       label: "Clip ready",       hint: "When a clip is ready for review or publishing." },
  { key: "team_activity",    label: "Team activity",    hint: "When teammates make changes to shared projects." },
  { key: "weekly_digest",    label: "Weekly digest",    hint: "Summary of performance and top clips every Monday." },
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
    <div className="divide-y divide-white/[.05]">
      {NOTIF_ROWS.map(({ key, label, hint }) => (
        <FieldRow key={key} label={label} hint={hint}>
          <Toggle checked={prefs[key]} onChange={() => toggle(key)} />
        </FieldRow>
      ))}
    </div>
  );
}

// ── API Keys ──────────────────────────────────────────────────────────────────

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
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await settingsApi.revokeApiKey(id);
      setKeys(prev => prev?.filter(k => k.id !== id) ?? null);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-5 py-4">
      {revealedKey && (
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4">
          <p className="mb-2 text-xs font-semibold text-emerald-400">Key generated — copy it now, it won't be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-black/30 px-3 py-2 font-mono text-xs text-emerald-300">{revealedKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedKey); setRevealedKey(null); }}
              className="h-8 cursor-pointer rounded-lg border border-emerald-800/40 bg-emerald-950/30 px-3 text-xs font-medium text-emerald-400 transition hover:bg-emerald-950/50"
            >
              Copy & close
            </button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <p className="mb-1.5 text-xs font-medium text-zinc-400">Key name</p>
          <TextInput
            placeholder="e.g. Production"
            value={newKeyName}
            onChange={setNewKeyName}
            className="w-full"
          />
        </div>
        <button
          onClick={create}
          disabled={creating || !newKeyName.trim()}
          className="h-9 cursor-pointer rounded-lg bg-[#ff3d6a] px-4 text-xs font-semibold text-white transition hover:bg-[#e8304f] disabled:opacity-50"
        >
          {creating ? "Generating…" : "Generate key"}
        </button>
      </div>

      {keys === null ? (
        <FieldSkeleton rows={2} />
      ) : keys.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-600">No API keys yet.</p>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className="rounded-xl border border-white/[.06] bg-white/[.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-200">{k.name}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-500">{k.key_prefix}</p>
                </div>
                <button
                  onClick={() => revoke(k.id)}
                  disabled={revoking === k.id}
                  className="cursor-pointer text-xs text-red-500/70 transition hover:text-red-400 disabled:opacity-50"
                >
                  {revoking === k.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
              <div className="mt-3 flex items-center gap-4">
                <span className="text-xs text-zinc-600">Created {new Date(k.created_at).toLocaleDateString()}</span>
                {k.last_used_at && <span className="text-xs text-zinc-600">Last used {new Date(k.last_used_at).toLocaleDateString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-amber-900/30 bg-amber-950/20 p-4">
        <p className="text-xs font-medium text-amber-400/80">API keys grant full access to your workspace. Never share them in client-side code or public repos.</p>
      </div>
    </div>
  );
}

// ── Security ──────────────────────────────────────────────────────────────────

function SecuritySection() {
  const [twoFactor, setTwoFactor] = useState(false);
  return (
    <div className="divide-y divide-white/[.05]">
      <FieldRow label="Change password" hint="Update your account password.">
        <button className="h-9 cursor-pointer rounded-lg border border-white/[.08] bg-white/[.03] px-4 text-xs font-medium text-zinc-400 transition hover:border-white/[.15] hover:text-zinc-200">
          Update password
        </button>
      </FieldRow>
      <FieldRow label="Two-factor authentication" hint="Require a second factor when signing in.">
        <Toggle checked={twoFactor} onChange={setTwoFactor} />
      </FieldRow>
      <FieldRow label="Active sessions" hint="Devices currently signed into your workspace.">
        <button className="h-9 cursor-pointer rounded-lg border border-white/[.08] bg-white/[.03] px-4 text-xs font-medium text-zinc-400 transition hover:border-white/[.15] hover:text-zinc-200">
          View sessions
        </button>
      </FieldRow>
      <FieldRow label="Sign out everywhere" hint="Revoke all active sessions except this one.">
        <button className="h-9 cursor-pointer rounded-lg border border-red-900/30 bg-red-950/20 px-4 text-xs font-medium text-red-400/80 transition hover:border-red-800/50 hover:text-red-400">
          Sign out all
        </button>
      </FieldRow>
      <div className="py-4">
        <p className="mb-3 text-sm font-medium text-zinc-200">Danger zone</p>
        <button className="h-9 cursor-pointer rounded-lg border border-red-900/30 bg-red-950/10 px-4 text-xs font-medium text-red-500/70 transition hover:border-red-800/50 hover:bg-red-950/20 hover:text-red-400">
          Delete workspace
        </button>
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function FieldSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-white/[.05]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-4">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-36 bg-white/[.04]" />
            <Skeleton className="h-3 w-56 bg-white/[.025]" />
          </div>
          <Skeleton className="h-9 w-28 rounded-lg bg-white/[.04]" />
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CONTENT: Record<SectionId, React.ReactNode> = {
  workspace:     <WorkspaceSection />,
  brand:         <BrandSection />,
  team:          <TeamSection />,
  billing:       <BillingSection />,
  notifications: <NotificationsSection />,
  api:           <ApiKeysSection />,
  security:      <SecuritySection />,
};

export function SettingsPage() {
  const [active, setActive] = useState<SectionId>("workspace");
  const section = SECTIONS.find(s => s.id === active)!;

  return (
    <div className="flex min-h-[calc(100vh-116px)] overflow-hidden rounded-2xl border border-white/[.07] bg-[#0b111c]">
      {/* Sidebar */}
      <nav className="hidden w-52 shrink-0 flex-col border-r border-white/[.05] bg-[#090e16]/60 p-3 sm:flex">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Settings</p>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition",
              active === s.id
                ? "bg-white/[.06] font-semibold text-zinc-100"
                : "text-zinc-500 hover:bg-white/[.03] hover:text-zinc-300"
            )}
          >
            <span className="text-base leading-none">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </nav>

      {/* Mobile tab strip */}
      <div className="absolute left-0 right-0 top-0 border-b border-white/[.05] sm:hidden">
        <div className="flex overflow-x-auto gap-1 p-2">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition",
                active === s.id ? "bg-white/[.08] text-zinc-100" : "text-zinc-500"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-white/[.05] bg-[#090e16]/40 px-6 py-5">
          <h1 className="text-xl font-black text-white">{section.label}</h1>
          <p className="mt-0.5 text-sm text-zinc-500">{section.desc}</p>
        </div>
        <div className="px-6 py-2">
          {CONTENT[active]}
        </div>
      </div>
    </div>
  );
}
