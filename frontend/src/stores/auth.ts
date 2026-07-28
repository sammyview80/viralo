import { auth as api, token, type UserResponse } from "@/lib/api";
import { createStore } from "@/lib/store";

interface AuthState {
  user: UserResponse | null;
  loading: boolean;
  ready: boolean;
}

const { setState, getState, useStore } = createStore<AuthState>({ user: null, loading: false, ready: false });

export { getState };

/* ─── Refresh in-memory user (e.g. after onboarding issues a new token) ─── */
export async function refreshUser() {
  const user = await api.me();
  setState({ user });
  return user;
}

/* ─── Store a new token then hand off navigation.
   SPA navigate is only safe once in-memory user state reflects the new
   token — otherwise route guards read stale state and bounce back.
   On refresh failure, fall back to a hard navigation so the next page
   load re-hydrates from the new token instead of trusting stale state. ─── */
export async function applyTokenAndRedirect(
  accessToken: string,
  dest: string,
  spaNavigate: (dest: string) => void,
  hardNavigate: (dest: string) => void = (d) => { window.location.href = d; },
) {
  token.set(accessToken);
  try {
    await refreshUser();
    spaNavigate(dest);
  } catch {
    hardNavigate(dest);
  }
}

/* ─── Hydration — called once on app boot ─── */
export async function hydrate() {
  const hasToken   = Boolean(token.get());
  const hasSession = token.hasSession();

  if (!hasToken && !hasSession) {
    setState({ ready: true });
    return;
  }

  if (hasToken) {
    try {
      const user = await api.me();
      setState({ user, ready: true });
      return;
    } catch {
      // Token expired or invalid — fall through to refresh
    }
  }

  try {
    const res = await api.refresh();
    token.set(res.access_token);
    const user = await api.me();
    setState({ user, ready: true });
  } catch {
    token.clear();
    setState({ user: null, ready: true });
  }
}

/* ─── Actions ─── */
export async function login(email: string, password: string) {
  setState({ loading: true });
  try {
    const res = await api.login({ email, password });
    token.set(res.access_token);
    const user = await api.me();
    setState({ user, loading: false });
    return user;
  } catch (e) {
    setState({ loading: false });
    throw e;
  }
}

export async function register(
  email: string,
  password: string,
  full_name: string,
  subdomain: string,
) {
  setState({ loading: true });
  try {
    const res = await api.register({ email, password, full_name, subdomain });
    token.set(res.access_token);
    const user = await api.me();
    setState({ user, loading: false });
    return user;
  } catch (e) {
    setState({ loading: false });
    throw e;
  }
}

export async function logout() {
  try { await api.logout(); } catch { /* best-effort: blacklists refresh cookie on server */ }
  token.clear();
  setState({ user: null });
  window.location.replace("/login");
}

export function useAuth() {
  return useStore();
}
