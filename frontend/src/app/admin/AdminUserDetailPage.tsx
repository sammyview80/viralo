import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { adminApi, ApiError, type UserDetailResponse } from "@/lib/api";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "gray" | "red" }) {
  const tones = {
    green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    gray: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    red: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-c-border bg-surface-2 p-5">
      <p className="mb-4 text-[13px] font-semibold text-c-text">{title}</p>
      {children}
    </div>
  );
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function AdminUserDetailPage({ userId }: { userId: string }) {
  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    adminApi
      .userDetail(userId)
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          navigate("/admin");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Failed to load user detail");
      })
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div>
      <button
        onClick={() => navigate("/admin/users")}
        className="mb-6 flex items-center gap-1.5 text-[12.5px] font-medium text-c-text-secondary hover:text-c-text"
      >
        <ArrowLeft size={14} /> Back to users
      </button>

      {error && (
        <div className="mb-5 rounded-[10px] border border-red-500/20 bg-red-500/[.08] px-4 py-3 text-[12.5px] text-red-300">
          {error}
        </div>
      )}

      {loading && <p className="text-[13px] text-c-text-muted">Loading…</p>}

      {data && (
        <>
          <div className="mb-8">
            <h1 className="font-display text-[24px] font-bold text-c-text">
              {data.profile.full_name ?? data.profile.email}
            </h1>
            <p className="mt-1 text-[13px] text-c-text-muted">{data.profile.email}</p>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Profile">
              <dl className="grid grid-cols-2 gap-y-2.5 text-[13px]">
                <dt className="text-c-text-muted">Tenant ID</dt>
                <dd className="truncate text-c-text">{data.profile.tenant_id ?? "—"}</dd>
                <dt className="text-c-text-muted">Signed up</dt>
                <dd className="text-c-text">{new Date(data.profile.created_at).toLocaleString()}</dd>
                <dt className="text-c-text-muted">Last login</dt>
                <dd className="text-c-text">{data.profile.last_login_at ? new Date(data.profile.last_login_at).toLocaleString() : "never"}</dd>
                <dt className="text-c-text-muted">Account status</dt>
                <dd><Badge tone={data.profile.is_active ? "green" : "red"}>{data.profile.is_active ? "active" : "disabled"}</Badge></dd>
                <dt className="text-c-text-muted">Admin</dt>
                <dd className="text-c-text">{data.profile.is_superadmin ? "superadmin" : data.profile.is_admin ? "admin" : "—"}</dd>
              </dl>
            </Panel>

            <Panel title="Subscription">
              <dl className="grid grid-cols-2 gap-y-2.5 text-[13px]">
                <dt className="text-c-text-muted">Tier</dt>
                <dd><Badge tone={data.profile.tier === "free" ? "gray" : "green"}>{data.profile.tier}</Badge></dd>
                <dt className="text-c-text-muted">Status</dt>
                <dd>
                  <Badge tone={data.profile.subscription_status === "active" ? "green" : data.profile.subscription_status ? "red" : "gray"}>
                    {data.profile.subscription_status ?? "no subscription"}
                  </Badge>
                </dd>
                <dt className="text-c-text-muted">Billing cycle</dt>
                <dd className="text-c-text">{data.profile.billing_cycle ?? "—"}</dd>
                <dt className="text-c-text-muted">Period ends</dt>
                <dd className="text-c-text">{data.profile.current_period_end ? new Date(data.profile.current_period_end).toLocaleDateString() : "—"}</dd>
                <dt className="text-c-text-muted">MCP API key</dt>
                <dd><Badge tone={data.has_active_api_key ? "green" : "gray"}>{data.has_active_api_key ? "has key" : "none"}</Badge></dd>
              </dl>
            </Panel>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Panel title="Videos"><p className="font-display text-[26px] font-bold text-c-text">{data.videos_count}</p></Panel>
            <Panel title="Clips"><p className="font-display text-[26px] font-bold text-c-text">{data.clips_count}</p></Panel>
            <Panel title="Storage used"><p className="font-display text-[26px] font-bold text-c-text">{formatBytes(data.storage_bytes_used)}</p></Panel>
            <Panel title="Social accounts"><p className="font-display text-[26px] font-bold text-c-text">{data.social_accounts.length}</p></Panel>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="Connected social accounts">
              {data.social_accounts.length === 0 ? (
                <p className="text-[12.5px] text-c-text-muted">No accounts connected.</p>
              ) : (
                <ul className="space-y-2">
                  {data.social_accounts.map((sa, i) => (
                    <li key={i} className="flex items-center justify-between text-[13px]">
                      <span className="text-c-text">{sa.platform}{sa.platform_username ? ` · @${sa.platform_username}` : ""}</span>
                      <div className="flex items-center gap-2">
                        <Badge tone={sa.is_active ? "green" : "gray"}>{sa.is_active ? "active" : "inactive"}</Badge>
                        <span className="text-c-text-muted">{new Date(sa.connected_at).toLocaleDateString()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Scheduled/posted content by platform">
              {data.scheduled_posts_by_platform.length === 0 ? (
                <p className="text-[12.5px] text-c-text-muted">No scheduled or posted content.</p>
              ) : (
                <ul className="space-y-2">
                  {data.scheduled_posts_by_platform.map((row, i) => (
                    <li key={i} className="flex items-center justify-between text-[13px]">
                      <span className="text-c-text">{row.platform} · {row.status}</span>
                      <span className="text-c-text-muted">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Recent videos">
            {data.videos.length === 0 ? (
              <p className="text-[12.5px] text-c-text-muted">No videos yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-c-border text-[11px] uppercase tracking-[.06em] text-c-text-muted">
                      <th className="py-2 pr-4">Title</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.videos.map((v) => (
                      <tr key={v.id} className="border-b border-c-border/60 last:border-0">
                        <td className="py-2 pr-4 text-c-text">{v.title ?? "Untitled"}</td>
                        <td className="py-2 pr-4"><Badge tone={v.status === "completed" ? "green" : v.status === "failed" ? "red" : "gray"}>{v.status}</Badge></td>
                        <td className="py-2 pr-4 text-c-text-muted">{new Date(v.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
