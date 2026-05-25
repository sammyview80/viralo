const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost/api/v1";
const LS_ACCESS  = "viralo_access_token";
const LS_SESSION = "viralo_has_session"; // flag: refresh cookie likely valid

/* ─── Token store — access token persisted, refresh token is httpOnly cookie ─── */
let _accessToken: string | null = localStorage.getItem(LS_ACCESS);

export const token = {
  get: () => _accessToken,

  set: (t: string) => {
    _accessToken = t;
    localStorage.setItem(LS_ACCESS, t);
    localStorage.setItem(LS_SESSION, "1"); // mark that a refresh cookie was issued
  },

  clear: () => {
    _accessToken = null;
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_SESSION);
  },

  /* true if we believe a refresh cookie exists (set on every successful login/register/refresh) */
  hasSession: () => localStorage.getItem(LS_SESSION) === "1",
};

/* ─── Refresh lock — one in-flight refresh at a time ─── */
let _refreshPromise: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = _rawFetch<TokenResponse>("POST", "/auth/refresh", undefined, false)
    .then((res) => {
      token.set(res.access_token); // also refreshes LS_SESSION flag
      return res.access_token;
    })
    .catch((err) => {
      token.clear(); // wipe everything — session dead
      window.location.replace("/login");
      throw err;
    })
    .finally(() => { _refreshPromise = null; });

  return _refreshPromise;
}

/* ─── Raw fetch (no 401 retry) ─── */
async function _rawFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  withAuth = true,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth && _accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "include", // sends httpOnly viralo_refresh cookie
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const raw = data?.detail ?? data?.message ?? `HTTP ${res.status}`;
    const msg = Array.isArray(raw) ? (raw[0]?.msg ?? String(raw)) : String(raw);
    throw new ApiError(res.status, msg);
  }

  return data as T;
}

/* ─── Public fetch — auto 401 → refresh → retry ─── */
export async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { auth?: boolean } = {},
): Promise<T> {
  const withAuth = opts.auth !== false;

  try {
    return await _rawFetch<T>(method, path, body, withAuth);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && withAuth) {
      const newToken = await doRefresh(); // throws + redirects if refresh fails
      _accessToken = newToken;
      return _rawFetch<T>(method, path, body, true); // retry once
    }
    throw err;
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/* ─── Types ─── */
export interface RegisterPayload { email: string; password: string; full_name: string; subdomain: string }
export interface LoginPayload    { email: string; password: string }
export interface TokenResponse   { access_token: string; token_type: string }
export interface UserResponse    { id: string; email: string; full_name: string | null; tenant_id: string; is_verified: boolean; onboarding_step: number | null }

/* ─── Auth endpoints ─── */
export const auth = {
  register: (p: RegisterPayload) => req<TokenResponse>("POST", "/auth/register", p, { auth: false }),
  login:    (p: LoginPayload)    => req<TokenResponse>("POST", "/auth/login",    p, { auth: false }),
  refresh:  ()                   => _rawFetch<TokenResponse>("POST", "/auth/refresh", undefined, false),
  logout:   ()                   => req<void>("POST", "/auth/logout"),
  me:       ()                   => req<UserResponse>("GET",  "/auth/me"),
};

/* ─── Onboarding types ─── */
export interface StepResponse     { step: number | null; is_complete: boolean; message: string }
export interface FinalizeResponse { access_token: string; token_type: string; message: string }

/* ─── Onboarding endpoints ─── */
export const onboarding = {
  niche:    (niche: string, subdomain: string)  => req<StepResponse>("POST", "/onboarding/niche",   { niche, subdomain }),
  source:   (source: string)                    => req<StepResponse>("POST", "/onboarding/source",  { source }),
  goal:     (goal: string)                      => req<StepResponse>("POST", "/onboarding/goal",    { goal }),
  connect:  (platform: string)                  => req<StepResponse>("POST", "/onboarding/connect", { platform }),
  plan:     (plan: string)                      => req<StepResponse>("POST", "/onboarding/plan",    { plan }),
  finalize: ()                                  => req<FinalizeResponse>("POST", "/onboarding/finalize"),
  skip:     ()                                  => req<FinalizeResponse>("POST", "/onboarding/skip"),
};

/* ─── Video service (port 8003) ─── */
const VIDEO_BASE = import.meta.env.VITE_VIDEO_BASE ?? "http://localhost:8003/api/v1";

async function _videoFetch<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
  const headers: Record<string, string> = {};
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  let fetchBody: BodyInit | undefined;
  if (body instanceof FormData) {
    fetchBody = body; // browser sets multipart Content-Type with boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${VIDEO_BASE}${path}`, {
    method, headers, credentials: "include", body: fetchBody,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const raw = data?.detail ?? data?.message ?? `HTTP ${res.status}`;
    const msg = Array.isArray(raw) ? (raw[0]?.msg ?? String(raw)) : String(raw);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

async function videoReq<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
  try {
    return await _videoFetch<T>(method, path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const newToken = await doRefresh();
      _accessToken = newToken;
      return _videoFetch<T>(method, path, body);
    }
    throw err;
  }
}

export interface VideoResponse {
  id: string;
  title: string | null;
  source_type: string;
  status: string;
  pipeline_step: string | null;
  pipeline_pct: number;
  storage_url: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  celery_task_id: string | null;
  clip_config: ClipConfig | null;
  error_message: string | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export type VideoListResponse = PaginatedResponse<VideoResponse>;

export interface ClipPlatformContent {
  description: string;
  tags: string[];
}

export interface ClipApiResponse {
  id: string;
  video_id: string;
  title: string | null;
  start_ms: number | null;
  end_ms: number | null;
  duration_ms: number | null;
  platform: string | null;
  score: number | null;
  status: string;
  storage_url: string | null;
  thumbnail_url: string | null;
  caption_srt: string | null;
  clip_metadata: {
    ai_title?: string;
    viral_reason?: string;
    viral_score?: number;
    platforms?: Record<string, ClipPlatformContent>;
  } | null;
  upload_attempts: number | null;
  upload_error: string | null;
  created_at: string;
}

export type ClipListResponse = PaginatedResponse<ClipApiResponse>;

function normalizePaginated<T>(data: PaginatedResponse<T> | T[] | null | undefined, page: number, per_page: number): PaginatedResponse<T> {
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page, per_page };
  }
  const maybe = data as Partial<PaginatedResponse<T>> | null | undefined;
  const items = Array.isArray(maybe?.items) ? maybe.items : [];
  return {
    items,
    total: typeof maybe?.total === "number" ? maybe.total : items.length,
    page: typeof maybe?.page === "number" ? maybe.page : page,
    per_page: typeof maybe?.per_page === "number" ? maybe.per_page : per_page,
  };
}

export interface ClipConfig {
  language?: string;
  max_clips?: number;
  min_score?: number;
  platforms?: string[];
  topic_focus?: string | null;
  add_captions?: boolean;
  caption_style?: string;
  aspect_ratio?: string;
  duration_max?: number;
  duration_min?: number;
  output_quality?: "source" | "1080p" | "720p" | "480p";
}

export const videoApi = {
  upload: (file: File, title: string, config?: ClipConfig) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    if (config) fd.append("config", JSON.stringify(config));
    return videoReq<VideoResponse>("POST", "/video/upload", fd);
  },
  youtube: (url: string, title?: string, config?: ClipConfig) =>
    videoReq<VideoResponse>("POST", "/video/youtube", {
      url,
      ...(title ? { title } : {}),
      ...(config ? { config } : {}),
    }),
  get:     (id: string) => videoReq<VideoResponse>("GET", `/videos/${id}`),
  list:    (page = 1, per_page = 20) =>
    videoReq<VideoListResponse | VideoResponse[]>("GET", `/videos?page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<VideoResponse>(data, page, per_page)),
  clips:   (videoId: string, page = 1, per_page = 100) =>
    videoReq<ClipListResponse | ClipApiResponse[]>("GET", `/clips?video_id=${videoId}&page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<ClipApiResponse>(data, page, per_page)),
  listClips: (page = 1, per_page = 24) =>
    videoReq<ClipListResponse | ClipApiResponse[]>("GET", `/clips?page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<ClipApiResponse>(data, page, per_page)),
  patchClip: (clipId: string, patch: { tags?: string[]; platform_copy?: Record<string, { description: string; tags: string[] }> }) =>
    videoReq<ClipApiResponse>("PATCH", `/clips/${clipId}`, patch),
  delete:  (id: string) => videoReq<void>("DELETE", `/videos/${id}`),
  cancel:  (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/cancel`),
  retry:        (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/retry`),
  fetchMetadata:(id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/fetch-metadata`),
};

/* ─── Platform service (port 8006) ─── */
const PLATFORM_BASE = import.meta.env.VITE_PLATFORM_BASE ?? "http://localhost:8006/api/v1";

async function _platformFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;
  const res = await fetch(`${PLATFORM_BASE}${path}`, {
    method, headers, credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.detail ?? data?.message ?? `HTTP ${res.status}`;
    const msg = Array.isArray(raw) ? (raw[0]?.msg ?? String(raw)) : String(raw);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

async function platformReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await _platformFetch<T>(method, path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const newToken = await doRefresh();
      _accessToken = newToken;
      return _platformFetch<T>(method, path, body);
    }
    throw err;
  }
}

/* ─── Platform types ─── */
export interface SocialAccount {
  id: string;
  platform: string;
  platform_username: string | null;
  is_active: boolean;
  token_expires_at: string | null;
  created_at: string;
}

export interface ScheduledPost {
  id: string;
  clip_id: string;
  social_account_id: string;
  platform: string;
  status: string; // pending|processing|posted|failed|cancelled
  scheduled_at: string;
  posted_at: string | null;
  platform_post_id: string | null;
  caption: string | null;
  hashtags: string[];
  retry_count: number;
  last_error: string | null;
  created_at: string;
}

export interface ScheduledPostCreate {
  clip_id: string;
  social_account_id: string;
  platform: string;
  scheduled_at: string; // ISO datetime
  caption?: string;
  hashtags?: string[];
}

export interface CalendarDay {
  date: string;
  posts: ScheduledPost[];
}

export interface OptimalTimeResponse {
  platform: string;
  suggested_times: string[];
}

export interface AnalyticsOverview {
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  engagement_rate: number;
  posts_count: number;
  period: string;
}

export interface PostAnalytics {
  scheduled_post_id: string;
  platform: string;
  platform_post_id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement_rate: number;
  virality_score: number | null;
  fetched_at: string;
}

export interface AppNotification {
  id: string;
  type: string | null;
  title: string;
  body: string | null;
  is_read: boolean;
  action_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

export type NotificationListResponse = PaginatedResponse<AppNotification>;
export type SocialAccountListResponse = PaginatedResponse<SocialAccount>;

/* ─── Platform API ─── */

// Deduplicate concurrent listAccounts calls — both SocialConnectBanner and BulkPublishModal call this on mount
let _accountsInflight: Promise<SocialAccount[]> | null = null;
let _accountsCache: { data: SocialAccount[]; at: number } | null = null;
function _listAccountsCached(): Promise<SocialAccount[]> {
  if (_accountsCache && Date.now() - _accountsCache.at < 30_000) return Promise.resolve(_accountsCache.data);
  if (_accountsInflight) return _accountsInflight;
  _accountsInflight = platformReq<SocialAccountListResponse | SocialAccount[]>("GET", "/social-accounts?per_page=100")
    .then((data) => normalizePaginated<SocialAccount>(data, 1, 100).items)
    .then((data) => { _accountsCache = { data, at: Date.now() }; return data; })
    .finally(() => { _accountsInflight = null; });
  return _accountsInflight;
}

export const platformApi = {
  // Social accounts
  connectOAuth: (platform: string, code: string, redirect_uri: string, extra?: Record<string, string>) =>
    platformReq<{ account_id: string; platform: string; username: string }>(
      "POST", "/oauth/connect", { platform, code, redirect_uri, ...extra }
    ).then((r) => { _accountsCache = null; return r; }),
  listAccounts: _listAccountsCached,
  deleteAccount: (id: string) => platformReq<void>("DELETE", `/social-accounts/${id}`)
    .then((r) => { _accountsCache = null; return r; }),

  // Scheduling
  schedulePost: (data: ScheduledPostCreate) =>
    platformReq<ScheduledPost>("POST", "/scheduled-posts", data),
  listPosts: (params?: { platform?: string; status?: string; from?: string; to?: string; page?: number; per_page?: number }) => {
    const q = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
      });
    }
    return platformReq<PaginatedResponse<ScheduledPost> | ScheduledPost[]>(
      "GET", `/scheduled-posts${q.toString() ? `?${q.toString()}` : ""}`
    ).then((data) => normalizePaginated<ScheduledPost>(data, params?.page ?? 1, params?.per_page ?? 20));
  },
  getPost: (id: string) => platformReq<ScheduledPost>("GET", `/scheduled-posts/${id}`),
  updatePost: (id: string, data: Partial<Pick<ScheduledPost, "scheduled_at" | "caption" | "hashtags">>) =>
    platformReq<ScheduledPost>("PATCH", `/scheduled-posts/${id}`, data),
  cancelPost: (id: string) => platformReq<void>("DELETE", `/scheduled-posts/${id}`),
  publishNow: (id: string) => platformReq<ScheduledPost>("POST", `/scheduled-posts/${id}/publish-now`),
  getCalendar: (month: string) =>
    platformReq<CalendarDay[]>("GET", `/calendar?month=${month}`),
  optimalTime: (platform: string) =>
    platformReq<OptimalTimeResponse>("GET", `/optimal-time/${platform}`),

  // Analytics
  analyticsOverview: (period: "7d" | "30d" | "90d" = "30d") =>
    platformReq<AnalyticsOverview>("GET", `/analytics/overview?period=${period}`),
  analyticsPosts: (page = 1, per_page = 10) =>
    platformReq<PaginatedResponse<PostAnalytics> | PostAnalytics[]>("GET", `/analytics/posts?page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<PostAnalytics>(data, page, per_page)),

  // Notifications
  listNotifications: (unread?: boolean, page = 1, per_page = 20) =>
    platformReq<NotificationListResponse | AppNotification[]>("GET", `/notifications?${unread !== undefined ? `unread=${unread}&` : ""}page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<AppNotification>(data, page, per_page)),
  markRead: (id: string) => platformReq<void>("PATCH", `/notifications/${id}/read`),
  markAllRead: () => platformReq<void>("POST", "/notifications/read-all"),
  deleteNotification: (id: string) => platformReq<void>("DELETE", `/notifications/${id}`),
};

export const notificationApi = {
  list: (unread?: boolean, page = 1) =>
    platformReq<NotificationListResponse | AppNotification[]>("GET", `/notifications?page=${page}&per_page=20${unread ? "&unread=true" : ""}`)
      .then((data) => normalizePaginated<AppNotification>(data, page, 20)),
  markRead: (id: string) => platformReq<AppNotification>("PATCH", `/notifications/${id}/read`),
  markAllRead: () => platformReq<void>("POST", `/notifications/read-all`),
  delete: (id: string) => platformReq<void>("DELETE", `/notifications/${id}`),
};

/* ─── Agent API (via nginx) ─── */
const AGENT_BASE = import.meta.env.VITE_AGENT_BASE ?? "http://localhost:8004/api/v1";

async function _agentFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;
  const res = await fetch(`${AGENT_BASE}${path}`, {
    method, headers, credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.detail ?? data?.message ?? `HTTP ${res.status}`;
    const msg = Array.isArray(raw) ? (raw[0]?.msg ?? String(raw)) : String(raw);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

async function agentReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await _agentFetch<T>(method, path, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const newToken = await doRefresh();
      _accessToken = newToken;
      return _agentFetch<T>(method, path, body);
    }
    throw err;
  }
}

export interface TagSuggestRequest {
  topic: string;
  niche?: string;
  extra_context?: string;
}

export interface PlatformCopy {
  description: string;
  tags: string[];
}

export interface TagSuggestResponse {
  primary_hashtags: string[];
  platforms: Record<string, PlatformCopy>;
}

export interface BrainstormSession {
  id: string;
  tenant_id: string;
  name: string | null;
  topic: string;
  status: "draft" | "running" | "paused" | "complete" | "failed" | "deleted";
  current_agent: string | null;
  agents_completed: string[] | null;
  niche_verdict: string | null;
  video_ideas: VideoIdea[] | null;
  generated_video_id: string | null;
  generated_workflow_id: string | null;
  created_at: string;
}

export interface VideoIdea {
  title: string;
  hook: string;
  format: string;
  estimated_views_potential: string;
  virality_score: number;
  reasoning: string;
}

export interface SessionListResponse {
  items: BrainstormSession[];
  total: number;
  page: number;
  per_page: number;
}

export const agentApi = {
  suggestTags: (data: TagSuggestRequest) =>
    agentReq<TagSuggestResponse>("POST", "/tags/suggest", data),

  createSession: (topic: string, name?: string) =>
    agentReq<BrainstormSession>("POST", "/sessions", { topic, name }),
  listSessions: (page = 1) =>
    agentReq<SessionListResponse>("GET", `/sessions?page=${page}&per_page=20`),
  getSession: (id: string) =>
    agentReq<BrainstormSession>("GET", `/sessions/${id}`),
  runSession: (id: string) =>
    agentReq<{ status: string; session_id: string }>("POST", `/sessions/${id}/run`),
  deleteSession: (id: string) =>
    agentReq<void>("DELETE", `/sessions/${id}`),
};
