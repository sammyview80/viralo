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
  created_at: string;
}

export interface VideoListResponse {
  items: VideoResponse[];
  total: number;
  page: number;
  per_page: number;
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
  created_at: string;
}

export const videoApi = {
  upload: (file: File, title: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    return videoReq<VideoResponse>("POST", "/video/upload", fd);
  },
  youtube: (url: string, title?: string) =>
    videoReq<VideoResponse>("POST", "/video/youtube", { url, ...(title ? { title } : {}) }),
  get:     (id: string) => videoReq<VideoResponse>("GET", `/videos/${id}`),
  list:    (page = 1, per_page = 20) =>
    videoReq<VideoListResponse>("GET", `/videos?page=${page}&per_page=${per_page}`),
  clips:   (videoId: string) =>
    videoReq<ClipApiResponse[]>("GET", `/clips?video_id=${videoId}`),
  delete:  (id: string) => videoReq<void>("DELETE", `/videos/${id}`),
  retry:   (id: string) => videoReq<VideoResponse>("POST", `/videos/${id}/retry`),
};
