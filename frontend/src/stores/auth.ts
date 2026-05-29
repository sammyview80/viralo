import { auth as api, token, type UserResponse } from "@/lib/api";
import { createStore } from "@/lib/store";

interface AuthState {
  user: UserResponse | null;
  loading: boolean;
  ready: boolean;
}

const { setState, useStore } = createStore<AuthState>({ user: null, loading: false, ready: false });

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
