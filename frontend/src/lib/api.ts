import { clearQueryCache } from "./query";

export const API_BASES = {
  core:     import.meta.env.VITE_API_BASE      ?? "/api/v1",
  video:    import.meta.env.VITE_VIDEO_BASE    ?? "/api/v1/video",
  platform: import.meta.env.VITE_PLATFORM_BASE ?? "/api/v1/platform",
  agent:    import.meta.env.VITE_AGENT_BASE    ?? "/api/v1/agent",
} as const;

const BASE = API_BASES.core;
const LS_ACCESS  = "viralo_access_token";
const LS_SESSION = "viralo_has_session"; // flag: refresh cookie likely valid

/* ─── Token store — access token in sessionStorage (XSS stopgap), refresh token is httpOnly cookie ─── */
let _accessToken: string | null = sessionStorage.getItem(LS_ACCESS);

export const token = {
  get: () => _accessToken,

  set: (t: string) => {
    _accessToken = t;
    sessionStorage.setItem(LS_ACCESS, t);
    localStorage.setItem(LS_SESSION, "1"); // mark that a refresh cookie was issued
    clearApiCaches();
  },

  clear: () => {
    _accessToken = null;
    sessionStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_SESSION);
    clearApiCaches();
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
export interface UserResponse    { id: string; email: string; full_name: string | null; tenant_id: string; is_verified: boolean; onboarding_step: number | null; plan: string | null }

/* ─── Auth endpoints ─── */
export const auth = {
  register: (p: RegisterPayload) => req<TokenResponse>("POST", "/auth/register", p, { auth: false }),
  login:    (p: LoginPayload)    => req<TokenResponse>("POST", "/auth/login",    p, { auth: false }),
  refresh:  ()                   => _rawFetch<TokenResponse>("POST", "/auth/refresh", undefined, false),
  logout:   ()                   => req<void>("POST", "/auth/logout"),
  me:       ()                   => req<UserResponse>("GET",  "/auth/me"),
};

/* ─── MCP Settings endpoints (same TenantApiKey used for MCP auth) ─── */
export const mcpSettings = {
  generateKey: (name: string) => req<ApiKeyCreated>("POST", "/settings/api-keys", { name }),
  listKeys: () => req<ApiKeyInfo[]>("GET", "/settings/api-keys"),
};

/* ─── CLI device-authorization flow (viralo login) ─── */
export const deviceAuth = {
  approve: (userCode: string) => req<void>("POST", "/device/approve", { user_code: userCode }),
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

/* ─── Generic service client factory — one per microservice ─── */
function createServiceClient(getBase: () => string) {
  async function _fetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

    let fetchBody: BodyInit | undefined;
    if (body instanceof FormData) {
      fetchBody = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }

    const res = await fetch(`${getBase()}${path}`, {
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

  async function serviceReq<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await _fetch<T>(method, path, body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const newToken = await doRefresh();
        _accessToken = newToken;
        return _fetch<T>(method, path, body);
      }
      throw err;
    }
  }

  return serviceReq;
}

/* ─── Video service (port 8003) ─── */
const videoReq = createServiceClient(() => API_BASES.video);

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
  metadata: Record<string, unknown> | null;
  created_at: string;
  source_url?: string | null;
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

export interface ScheduledPostSummary {
  id: string;
  clip_id: string;
  platform: string;
  status: string;
  scheduled_at: string;
  posted_at: string | null;
  created_at: string;
  last_error: string | null;
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
    niche?: string;
    topic?: string;
    platforms?: Record<string, ClipPlatformContent>;
    trending_hashtags?: string[];
    composite?: boolean;
    source_clip_ids?: string[];
    aspect_ratio?: string;
    platform_copy?: Record<string, { description: string; tags: string[] }>;
    ranking?: boolean;
    editor?: EditorData;
  } | null;
  upload_attempts: number | null;
  upload_error: string | null;
  upscaled_storage_url: string | null;
  created_at: string;
  scheduled_posts?: ScheduledPostSummary[];
}

export type ClipListResponse = PaginatedResponse<ClipApiResponse>;

/* ─── Editor types ─── */
export type EditorCaptionTemplate =
  | "default"
  | "modern"
  | "bouncy"
  | "mr-beast"
  | "business"
  | "clean"
  | "neon"
  | "podcast"
  | "cinematic"
  | "gaming"
  | "news"
  | "luxury"
  | "karaoke"
  | "meme"
  | "documentary"
  | "sports"
  | "soft";

export interface EditorCaption {
  id: string;
  text: string;
  start_sec: number;
  end_sec: number;
  position: "top" | "center" | "bottom";
  color: string;
  font_size: number;
  template: EditorCaptionTemplate;
}

export interface EditorMarker {
  id: string;
  time_ms: number;
  sound: string;
  emoji: string;
  label: string;
}

export interface EditorData {
  trim_start_sec: number;
  trim_end_sec: number | null;
  captions: EditorCaption[];
  markers: EditorMarker[];
}

export interface EditorDataResponse {
  clip_id: string;
  editor: EditorData;
}

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
  max_clips?: number;
  min_score?: number;
  topic_focus?: string | null;
  add_captions?: boolean;
  skip_caption?: boolean;
  language?: string | null;
  caption_style?: string | null;
  aspect_ratio?: string;
  duration_max?: number;
  duration_min?: number;
  output_quality?: OutputQuality;
  template_id?: string | null;
  music?: boolean;
  music_track?: string | null;
  voiceover?: boolean;
  occasion?: string | null;
  auto_publish?: boolean;
  auto_publish_config?: {
    social_account_ids: string[];
    publish_per_day: number;
    publish_interval_hours?: number;
    publish_start_at?: string;
    caption_template?: string;
  } | null;
}

export interface CaptionStyleInfo {
  id: string;
  label: string;
  desc: string;
  family: "pill" | "reveal" | "pop" | "karaoke" | "outline" | "minimal"
    | "bounce" | "glow" | "shadow" | "highlighter" | "rainbow";
  highlight: string;
  uppercase: boolean;
}

export type OutputQuality = "source" | "1080p" | "720p" | "480p" | "360p";

export interface YouTubeInspectResponse {
  valid: boolean;
  url: string;
  video_id?: string | null;
  title?: string | null;
  channel?: string | null;
  duration_sec?: number | null;
  thumbnail_url?: string | null;
  view_count?: number | null;
  upload_date?: string | null;
  description?: string | null;
  error?: string | null;
}

export interface YouTubeFormatInfo {
  height: number;
  fps?: number | null;
  ext?: string | null;
  filesize?: number | null;
}

export interface YouTubeFormatsResponse {
  url: string;
  qualities: OutputQuality[];
  max_height: number;
  title?: string | null;
  duration?: number | null;
  formats: YouTubeFormatInfo[];
}

export const videoApi = {
  progressStream: async (jobId: string) => {
    const { ticket } = await videoReq<{ ticket: string }>("POST", `/progress/${jobId}/ticket`);
    return new EventSource(`${API_BASES.video}/progress/${jobId}?ticket=${encodeURIComponent(ticket)}`);
  },
  captionStyles: () => videoReq<CaptionStyleInfo[]>("GET", "/caption-styles"),
  upload: (file: File, title: string, config?: ClipConfig) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    if (config) fd.append("config", JSON.stringify(config));
    return videoReq<VideoResponse>("POST", "/upload", fd);
  },
  youtube: (url: string, title?: string, config?: ClipConfig) =>
    videoReq<VideoResponse>("POST", "/youtube", {
      url,
      ...(title ? { title } : {}),
      ...(config ? { config } : {}),
    }),
  youtubeFormats: (url: string) =>
    videoReq<YouTubeFormatsResponse>("POST", "/youtube/formats", { url }),
  youtubeInspect: (url: string) =>
    videoReq<YouTubeInspectResponse>("POST", "/youtube/inspect", { url }),
  get:     (id: string) => videoReq<VideoResponse>("GET", `/videos/${id}`),
  list:    (page = 1, per_page = 20) =>
    videoReq<VideoListResponse | VideoResponse[]>("GET", `/videos?page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<VideoResponse>(data, page, per_page)),
  listClipping: (page = 1, per_page = 20) =>
    videoReq<VideoListResponse | VideoResponse[]>("GET", `/videos/clipping?page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<VideoResponse>(data, page, per_page)),
  clips:   (videoId: string, page = 1, per_page = 100) =>
    videoReq<ClipListResponse | ClipApiResponse[]>("GET", `/clips?video_id=${videoId}&page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<ClipApiResponse>(data, page, per_page)),
  listClips: (page = 1, per_page = 24, minViralityScore?: number, sortBy?: "created_at" | "score") => {
    const qs = new URLSearchParams({ page: String(page), per_page: String(per_page) });
    if (minViralityScore !== undefined) qs.set("min_virality_score", String(minViralityScore));
    if (sortBy) qs.set("sort_by", sortBy);
    return videoReq<ClipListResponse | ClipApiResponse[]>("GET", `/clips?${qs}`)
      .then((data) => normalizePaginated<ClipApiResponse>(data, page, per_page));
  },
  patchClip: (clipId: string, patch: { tags?: string[]; platform_copy?: Record<string, { description: string; tags: string[] }> }) =>
    videoReq<ClipApiResponse>("PATCH", `/clips/${clipId}`, patch),
  saveEditorData: (clipId: string, data: EditorData) =>
    videoReq<EditorDataResponse>("PATCH", `/clips/${clipId}/editor`, data),
  getEditorData: (clipId: string) =>
    videoReq<EditorDataResponse>("GET", `/clips/${clipId}/editor`),
  delete:  (id: string) => videoReq<void>("DELETE", `/videos/${id}`),
  cancel:  (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/cancel`),
  retry:        (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/retry`),
  fetchMetadata:(id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/fetch-metadata`),
  previewProxy: (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/preview-proxy`),
  downloadZip: async (clipIds: string[], zipName?: string): Promise<Blob> => {
    const base = API_BASES.video;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;
    const res = await fetch(`${base}/clips/download-zip`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ clip_ids: clipIds, zip_name: zipName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.detail ?? `HTTP ${res.status}`);
    }
    return res.blob();
  },
  mergeAiClips: (clipIds: string[]) =>
    videoReq<{ task_id: string; message: string }>("POST", "/clips/merge-ai", { clip_ids: clipIds }),
  retryClipUpload: (clipId: string) =>
    videoReq<ClipApiResponse>("POST", `/clips/${clipId}/retry-upload`),
  upscaleClip: (clipId: string, targetResolution: "1080p" | "4K" = "4K") =>
    videoReq<ClipApiResponse>("POST", `/clips/${clipId}/upscale?target_resolution=${targetResolution}`),
  listRanking: (page = 1, per_page = 20) =>
    videoReq<VideoListResponse | VideoResponse[]>("GET", `/videos/ranking?page=${page}&per_page=${per_page}`)
      .then((data) => normalizePaginated<VideoResponse>(data, page, per_page)),
  createRanking: (payload: {
    title: string;
    theme: string;
    order: string;
    segments: Array<{
      source_type: string;
      url?: string;
      video_id?: string;
      start_sec: number;
      end_sec: number;
      segment_title?: string;
    }>;
  }) => videoReq<{ video_id: string; job_id: string }>("POST", "/ranking", payload),
  createRankingPreview: (url: string) =>
    videoReq<{ preview_url: string; quality: string }>("POST", "/ranking/preview-source", { url }),
  suggestRankingTitle: (topic: string, segment_count: number) =>
    videoReq<{ title: string; highlight_words: string[] }>("POST", "/ranking/suggest-title", { topic, segment_count }),
};

export interface RenderStatus {
  render_id: string;
  clip_id: string;
  status: "queued" | "processing" | "done" | "error";
  progress_pct: number;
  download_url: string | null;
  error_message: string | null;
  created_at: string;
}

export interface RenderPayload {
  trim_start_sec: number;
  trim_end_sec: number | null;
  captions: EditorCaption[];
  markers: EditorMarker[];
  quality: "draft" | "720p" | "1080p";
}

// ── Series (faceless auto-generated videos) ─────────────────────────────────

export interface Series {
  id: string;
  name: string;
  niche: string;
  custom_prompt: string | null;
  example_script: string | null;
  language: string;
  voice: string;
  music_track: string | null;
  art_style: string;
  caption_style: string;
  effects: Record<string, boolean>;
  duration_sec: number;
  social_account_ids: string[];
  publish_time: string;
  cadence: "daily" | "3x_week" | "weekly";
  auto_publish: boolean;
  is_active: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
}

export type SeriesCreate = Omit<Series, "id" | "is_active" | "next_run_at" | "last_run_at" | "created_at">;

export interface SeriesOption { id: string; label: string }
export interface SeriesOptions {
  niches: SeriesOption[];
  languages?: SeriesOption[];
  voices: SeriesOption[];
  art_styles: SeriesOption[];
  music_tracks: SeriesOption[];
  cadences: SeriesOption[];
}

export interface SeriesVideo {
  id: string;
  title: string | null;
  status: string;
  duration_sec: number | null;
  thumbnail_url: string | null;
  clip_id: string | null;
  storage_url: string | null;
  clip_thumb: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
}

export const seriesApi = {
  options: () => videoReq<SeriesOptions>("GET", "/series/options"),
  list: () => videoReq<Series[]>("GET", "/series"),
  create: (data: Partial<SeriesCreate>) => videoReq<Series>("POST", "/series", data),
  update: (id: string, data: Partial<SeriesCreate> & { is_active?: boolean }) =>
    videoReq<Series>("PATCH", `/series/${id}`, data),
  remove: (id: string) => videoReq<void>("DELETE", `/series/${id}`),
  generateNow: (id: string) => videoReq<{ status: string; publish_at: string }>("POST", `/series/${id}/generate-now`),
  videos: (id: string) => videoReq<SeriesVideo[]>("GET", `/series/${id}/videos`),
};

export const renderApi = {
  async startRender(clipId: string, payload: RenderPayload): Promise<{ render_id: string }> {
    return videoReq<{ render_id: string }>("POST", `/clips/${clipId}/render`, payload);
  },

  async getStatus(clipId: string, renderId: string): Promise<RenderStatus> {
    return videoReq<RenderStatus>("GET", `/clips/${clipId}/render/${renderId}`);
  },
};

/* ─── Platform service (port 8006) ─── */
const platformReq = createServiceClient(() => API_BASES.platform);

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
  clip_storage_url?: string | null;
  clip_thumbnail_url?: string | null;
  created_at: string;
}

export interface ScheduledPostCreate {
  clip_id: string;
  social_account_id: string;
  platform: string;
  scheduled_at: string; // ISO datetime
  caption?: string;
  hashtags?: string[];
  platform_kwargs?: Record<string, unknown>;
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

export interface AnalyticsTimeseriesPoint {
  date: string;
  views: number;
}

export interface AnalyticsTimeseries {
  period: string;
  points: AnalyticsTimeseriesPoint[];
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
function clearApiCaches() {
  _accountsInflight = null;
  _accountsCache = null;
  clearQueryCache();
}
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
  analyticsTimeseries: (period: "7d" | "30d" | "90d" = "30d") =>
    platformReq<AnalyticsTimeseries>("GET", `/analytics/timeseries?period=${period}`),
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

export interface AutoPublishConfig {
  num_clips: number;
  aspect_ratio: string;
  platforms: string[];
  social_account_ids: string[];
  publish_per_day: number;
  publish_interval_hours: number;
  caption_template: string;
  burn_captions: boolean;
  min_clip_duration: number;
  max_clip_duration: number;
}

export const DEFAULT_AUTO_PUBLISH_CONFIG: AutoPublishConfig = {
  num_clips: 4,
  aspect_ratio: "9:16",
  platforms: ["tiktok", "instagram"],
  social_account_ids: [],
  publish_per_day: 3,
  publish_interval_hours: 8,
  caption_template: "",
  burn_captions: false,
  min_clip_duration: 30,
  max_clip_duration: 60,
};

export interface ChannelSubscription {
  id: string;
  channel_id: string;
  channel_name: string | null;
  channel_url: string | null;
  auto_publish: boolean;
  auto_publish_config: AutoPublishConfig | null;
  active: boolean;
  subscribed_at: string | null;
  lease_expires_at: string | null;
  last_video_id: string | null;
  last_notified_at: string | null;
  created_at: string;
}

export interface ChannelVideo {
  video_id: string;
  title: string;
  published: string;
  url: string;
  thumbnail: string;
  views: string | null;
  likes?: string | null;
  comments?: string | null;
  duration?: string | null;
  already_clipped?: boolean;
}

export const channelsApi = {
  list: () => platformReq<ChannelSubscription[]>("GET", "/websub/channels"),
  resolve: (q: string) =>
    platformReq<{ channel_id: string; channel_name: string }>("GET", `/websub/resolve?q=${encodeURIComponent(q)}`),
  subscribe: (body: { channel_id: string; channel_name?: string; channel_url?: string; auto_publish?: boolean; auto_publish_config?: AutoPublishConfig }) =>
    platformReq<{ channel_id: string; channel_name: string; status: string }>("POST", "/websub/channels", body),
  update: (channelId: string, body: { auto_publish?: boolean; auto_publish_config?: AutoPublishConfig }) =>
    platformReq<{ channel_id: string; updated: boolean }>("PATCH", `/websub/channels/${channelId}`, body),
  unsubscribe: (channelId: string) => platformReq<void>("DELETE", `/websub/channels/${channelId}`),
  recentVideos: (channelId: string) =>
    platformReq<{ channel_id: string; videos: ChannelVideo[] }>("GET", `/websub/channels/${channelId}/videos`),
  topVideos: (channelId: string, order: "viewCount" | "date" | "rating" = "viewCount") =>
    platformReq<{ channel_id: string; videos: ChannelVideo[]; order: string }>(
      "GET", `/websub/channels/${channelId}/top-videos?order=${order}&max_results=10`
    ),
};

export const notificationApi = {
  list: (unread?: boolean, page = 1) =>
    platformReq<NotificationListResponse | AppNotification[]>("GET", `/notifications?page=${page}&per_page=20${unread ? "&unread=true" : ""}`)
      .then((data) => normalizePaginated<AppNotification>(data, page, 20)),
  markRead: (id: string) => platformReq<AppNotification>("PATCH", `/notifications/${id}/read`),
  markAllRead: () => platformReq<void>("POST", `/notifications/read-all`),
  delete: (id: string) => platformReq<void>("DELETE", `/notifications/${id}`),
};

/* ─── Agent API ─── */
const agentReq = createServiceClient(() => API_BASES.agent);

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

export interface LyricVideoSource {
  type: "upload" | "youtube" | "spotify" | "metadata";
  title?: string | null;
  artist?: string | null;
  url?: string | null;
}

export interface LyricVideoPlanRequest {
  source: LyricVideoSource;
  rights_confirmed: boolean;
  transcript_text?: string | null;
  aspect_ratio?: "9:16" | "16:9" | "1:1" | "4:5" | null;
  template_hint?: string | null;
}

export interface LyricLinePlan {
  text: string;
  start_sec: number;
  end_sec: number;
  confidence: number;
  source: string;
}

export interface LyricVideoPlanResponse {
  source: Record<string, unknown>;
  rights: Record<string, unknown>;
  lyrics: LyricLinePlan[];
  template: Record<string, unknown>;
  warnings: string[];
  needs_transcription: boolean;
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
  planLyricVideo: (data: LyricVideoPlanRequest) =>
    agentReq<LyricVideoPlanResponse>("POST", "/lyric-videos/plan", data),

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

// ─── Billing API (via core service) ───
export interface PlanInfo {
  id: string;
  name: string;
  price_monthly: number;
  videos_per_month: number;  // -1 = unlimited
  storage_gb: number;
  brainstorm: boolean;
  brainstorm_sessions: number;
  workflows: boolean;
  channels: boolean;
  watermark: boolean;
  accounts_per_platform: number;
  video_duration_limit_min: number | null;
}

export interface SubscriptionInfo {
  plan_name: string;
  status: string;
  billing_cycle: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  videos_used: number;
  storage_bytes_used: number;
  brainstorm_used: number;
}

export interface EsewaQR {
  merchant_id: string;
  amount_npr: number;
  product_id: string;
  plan_name: string;
  instructions: string;
}

// ─── Trends API (via agent service) ───
export interface VideoMeta {
  platform: "youtube" | "tiktok" | "web" | string;
  video_id: string;
  title: string;
  url: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration_sec: number | null;
  published_at: string | null;
  channel: string | null;
  channel_id: string | null;
  channel_url: string | null;
  hashtags: string[];
  thumbnail: string | null;
  description: string;
}

export interface PlatformSummary {
  youtube_count: number;
  tiktok_count: number;
  web_count: number;
  total: number;
  from_cache: boolean;
}

export interface TrendSearchResponse {
  topic: string;
  from_cache: boolean;
  summary: PlatformSummary;
  top_by_views: VideoMeta[];
  common_hashtags: string[];
  youtube: VideoMeta[];
  tiktok: VideoMeta[];
  web: VideoMeta[];
  analysis?: {
    insights: string;
    suggested_topics: string[];
  };
}

export const trendsApi = {
  search: (topic: string, platforms?: string[], forceRefresh?: boolean) => {
    const qs = new URLSearchParams({ topic });
    (platforms ?? ["youtube", "tiktok", "web"]).forEach((p) => qs.append("platforms", p));
    if (forceRefresh) qs.set("force_refresh", "true");
    return agentReq<TrendSearchResponse>("GET", `/trends/search?${qs}`);
  },
  clearCache: (topic?: string) =>
    agentReq<{ deleted: number }>(
      "DELETE",
      `/trends/cache${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`,
    ),
};

export const billingApi = {
  plans: () => req<PlanInfo[]>("GET", "/billing/plans", undefined, { auth: false }),
  subscription: () => req<SubscriptionInfo>("GET", "/billing/subscription"),
  checkout: (plan_name: string, billing_cycle: string, success_url: string, cancel_url: string) =>
    req<{ checkout_url: string }>("POST", "/billing/checkout", { plan_name, billing_cycle, success_url, cancel_url }),
  confirm: (session_id: string) =>
    req<{ status: string; plan: string }>("POST", "/billing/confirm", { session_id }),
  esewaQR: (plan_name: string) =>
    req<EsewaQR>("GET", `/billing/esewa-qr?plan=${plan_name}`),
};

// ── Search ────────────────────────────────────────────────────────────────────
export interface SearchVideoHit {
  type: "video";
  id: string;
  title: string | null;
  status: string;
  thumbnail_url: string | null;
  duration_sec: number | null;
  created_at: string;
}

export interface SearchClipHit {
  type: "clip";
  id: string;
  video_id: string;
  title: string | null;
  platform: string | null;
  score: number | null;
  status: string;
  thumbnail_url: string | null;
  created_at: string;
}

export interface SearchResponse {
  query: string;
  videos: SearchVideoHit[];
  clips: SearchClipHit[];
}

export const searchApi = {
  global: (q: string, limit = 8) =>
    videoReq<SearchResponse>(
      "GET",
      `/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
};

// ── Settings ──────────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  id: string;
  display_name: string;
  subdomain: string;
  timezone: string;
  niche: string | null;
  goal: string | null;
}

export interface BrandKit {
  primary_color: string;
  secondary_color: string;
  font: string;
  watermark_url: string | null;
}

export interface NotificationPrefs {
  uploads_complete: boolean;
  clip_ready: boolean;
  team_activity: boolean;
  weekly_digest: boolean;
  billing_alerts: boolean;
  product_updates: boolean;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyCreated extends ApiKeyInfo {
  key: string; // shown once
}

export interface UpdateMePayload { full_name?: string; avatar_url?: string }

// ── Admin panel ──────────────────────────────────────────────────────────────

const LS_ADMIN_TOKEN = "viralo_admin_token";

export const adminToken = {
  get: () => sessionStorage.getItem(LS_ADMIN_TOKEN),
  set: (t: string) => sessionStorage.setItem(LS_ADMIN_TOKEN, t),
  clear: () => sessionStorage.removeItem(LS_ADMIN_TOKEN),
};

async function adminReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = adminToken.get();
  if (t) headers["Authorization"] = `Bearer ${t}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.detail ?? data?.message ?? `HTTP ${res.status}`;
    const msg = Array.isArray(raw) ? (raw[0]?.msg ?? String(raw)) : String(raw);
    if (res.status === 401 || res.status === 403) adminToken.clear();
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_admin: boolean;
  is_superadmin: boolean;
  tier: string;
  subscription_status: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminUserListResponse {
  items: AdminUserRow[];
  total: number;
  page: number;
  per_page: number;
}

export interface AdminUserStats {
  total_users: number;
  active_users: number;
  paid_users: number;
  by_tier: Record<string, number>;
}

export interface AdminMeResponse {
  id: string;
  email: string;
  is_admin: boolean;
  is_superadmin: boolean;
}

export const adminApi = {
  requestLogin: (email: string) =>
    adminReq<{ message: string }>("POST", "/admin/login/request", { email }),
  me: () => adminReq<AdminMeResponse>("GET", "/admin/me"),
  // This fetch call sends the token in a POST body, not a query string, so
  // this specific request never appears in server/proxy access logs or
  // Referer headers. The emailed link itself carries the token in the URL
  // fragment (see AdminVerifyPage) — that part is a separate concern.
  verifyLogin: (token: string) =>
    adminReq<{ access_token: string; token_type: string }>("POST", "/admin/login/verify", { token }),
  listUsers: (params: { page?: number; per_page?: number; search?: string; sort_by?: string; order?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.set(k, String(v)); });
    return adminReq<AdminUserListResponse>("GET", `/admin/users${qs.toString() ? `?${qs}` : ""}`);
  },
  userStats: () => adminReq<AdminUserStats>("GET", "/admin/users/stats"),
  changeTier: (userId: string, planName: string) =>
    adminReq<AdminUserRow>("POST", `/admin/users/${userId}/tier`, { plan_name: planName }),
  changeAdminRole: (userId: string, isAdmin: boolean) =>
    adminReq<AdminUserRow>("POST", `/admin/users/${userId}/admin-role`, { is_admin: isAdmin }),
};

export const settingsApi = {
  getMe:                 ()                              => req<UserResponse>("GET",   "/auth/me"),
  updateMe:              (body: UpdateMePayload)         => req<UserResponse>("PATCH", "/auth/me", body),

  getWorkspace:          ()                              => req<WorkspaceInfo>("GET",   "/tenants/me"),
  updateWorkspace:       (body: Partial<WorkspaceInfo>)  => req<WorkspaceInfo>("PATCH", "/tenants/me", body),

  getBrandKit:           ()                              => req<BrandKit>("GET",   "/settings/brand-kit"),
  updateBrandKit:        (body: Partial<BrandKit>)       => req<BrandKit>("PATCH", "/settings/brand-kit", body),

  getNotificationPrefs:  ()                              => req<NotificationPrefs>("GET",   "/settings/notification-prefs"),
  updateNotificationPrefs: (body: Partial<NotificationPrefs>) => req<NotificationPrefs>("PATCH", "/settings/notification-prefs", body),

  listApiKeys:           ()                              => req<ApiKeyInfo[]>("GET",    "/settings/api-keys"),
  createApiKey:          (name: string)                  => req<ApiKeyCreated>("POST",  "/settings/api-keys", { name }),
  revokeApiKey:          (id: string)                    => req<void>("DELETE", `/settings/api-keys/${id}`),
};
