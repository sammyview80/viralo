const BASE = "http://localhost:8001/api/v1";
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
const VIDEO_BASE = "http://localhost:8003/api/v1";

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
  created_at: string;
}

export interface VideoListResponse {
  items: VideoResponse[];
  total: number;
  page: number;
  per_page: number;
}

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
    platforms?: Record<string, ClipPlatformContent>;
  } | null;
  created_at: string;
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
    videoReq<VideoListResponse>("GET", `/videos?page=${page}&per_page=${per_page}`),
  clips:   (videoId: string) =>
    videoReq<ClipApiResponse[]>("GET", `/clips?video_id=${videoId}`),
  delete:  (id: string) => videoReq<void>("DELETE", `/videos/${id}`),
  retry:        (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/retry`),
  fetchMetadata:(id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/fetch-metadata`),
};

/* ─── Platform service (port 8006) ─── */
const PLATFORM_BASE = "http://localhost:8006/api/v1";

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

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface NotificationListResponse {
  items: Notification[];
  total: number;
}

/* ─── Platform API ─── */
export const platformApi = {
  // Social accounts
  connectOAuth: (platform: string, code: string, redirect_uri: string, extra?: Record<string, string>) =>
    platformReq<{ account_id: string; platform: string; username: string }>(
      "POST", "/oauth/connect", { platform, code, redirect_uri, ...extra }
    ),
  listAccounts: () => platformReq<SocialAccount[]>("GET", "/social-accounts"),
  deleteAccount: (id: string) => platformReq<void>("DELETE", `/social-accounts/${id}`),

  // Scheduling
  schedulePost: (data: ScheduledPostCreate) =>
    platformReq<ScheduledPost>("POST", "/scheduled-posts", data),
  listPosts: (params?: { platform?: string; status?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return platformReq<{ items: ScheduledPost[]; total: number; page: number; per_page: number }>(
      "GET", `/scheduled-posts${q ? `?${q}` : ""}`
    );
  },
  getPost: (id: string) => platformReq<ScheduledPost>("GET", `/scheduled-posts/${id}`),
  updatePost: (id: string, data: Partial<Pick<ScheduledPost, "scheduled_at" | "caption" | "hashtags">>) =>
    platformReq<ScheduledPost>("PATCH", `/scheduled-posts/${id}`, data),
  cancelPost: (id: string) => platformReq<void>("DELETE", `/scheduled-posts/${id}`),
  getCalendar: (month: string) =>
    platformReq<CalendarDay[]>("GET", `/calendar?month=${month}`),
  optimalTime: (platform: string) =>
    platformReq<OptimalTimeResponse>("GET", `/optimal-time/${platform}`),

  // Analytics
  analyticsOverview: (period: "7d" | "30d" | "90d" = "30d") =>
    platformReq<AnalyticsOverview>("GET", `/analytics/overview?period=${period}`),
  analyticsPosts: (page = 1) =>
    platformReq<{ items: PostAnalytics[]; total: number }>("GET", `/analytics/posts?page=${page}`),

  // Notifications
  listNotifications: (unread?: boolean) =>
    platformReq<NotificationListResponse>("GET", `/notifications${unread ? "?unread=true" : ""}`),
  markRead: (id: string) => platformReq<void>("PATCH", `/notifications/${id}/read`),
  markAllRead: () => platformReq<void>("POST", "/notifications/read-all"),
  deleteNotification: (id: string) => platformReq<void>("DELETE", `/notifications/${id}`),
};
