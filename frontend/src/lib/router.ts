import { useState, useEffect } from "react";

export function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const handler = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);
  return path;
}

export function useSearchParams(): [
  URLSearchParams,
  (key: string, value: string) => void,
  (key: string) => void,
] {
  const [search, setSearch] = useState(window.location.search);

  useEffect(() => {
    const handler = () => setSearch(window.location.search);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(window.location.search);
    p.set(key, value);
    history.pushState(null, "", `${window.location.pathname}?${p.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const deleteParam = (key: string) => {
    const p = new URLSearchParams(window.location.search);
    p.delete(key);
    const qs = p.toString();
    history.pushState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return [new URLSearchParams(search), setParam, deleteParam];
}
