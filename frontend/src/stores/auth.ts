import { useState, useEffect } from "react";
import { auth as api, token, type UserResponse } from "@/lib/api";

/* ─── Module-level reactive store ─── */
type Listener = () => void;
const listeners = new Set<Listener>();

interface State {
  user: UserResponse | null;
  loading: boolean;
  ready: boolean;
}

let state: State = { user: null, loading: false, ready: false };

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/* ─── Hydration — called once on app boot ─── */
export async function hydrate() {
  const hasToken   = Boolean(token.get());
  const hasSession = token.hasSession();

  // No stored token and no session flag → not logged in, skip network calls
  if (!hasToken && !hasSession) {
    setState({ ready: true });
    return;
  }

  // Have an access token → try /me (fast path, avoids refresh round-trip)
  if (hasToken) {
    try {
      const user = await api.me();
      setState({ user, ready: true });
      return;
    } catch {
      // Token expired or invalid — fall through to refresh
    }
  }

  // Access token missing or rejected — attempt refresh via httpOnly cookie
  try {
    const res = await api.refresh();
    token.set(res.access_token);
    const user = await api.me();
    setState({ user, ready: true });
  } catch {
    // Refresh cookie also dead — full logout
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

/* ─── React hook ─── */
export function useAuth() {
  const [, tick] = useState(0);
  useEffect(() => {
    const rerender = () => tick((n) => n + 1);
    listeners.add(rerender);
    return () => { listeners.delete(rerender); };
  }, []);
  return state;
}
