import { token } from "@/lib/api";
import type { ProjectDoc, ProjectSummary, Scene, Shot } from "./types";

const BASE = import.meta.env.VITE_VEROAGEN_BASE ?? "http://localhost:8100";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.get() ?? ""}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`veroagen ${method} ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export const veroagenApi = {
  createProject: (title: string) => req<{ id: string; doc: ProjectDoc }>("POST", "/projects", { title }),
  listProjects: () => req<ProjectSummary[]>("GET", "/projects"),
  getProject: (id: string) => req<{ id: string; doc: ProjectDoc }>("GET", `/projects/${id}`),
  chat: (id: string, message: string) => req<{ doc: ProjectDoc }>("POST", `/projects/${id}/chat`, { message }),
  putScript: (id: string, scenes: Scene[]) => req<{ doc: ProjectDoc }>("PUT", `/projects/${id}/script`, { scenes }),
  putStoryboard: (id: string, shots: Shot[]) => req<{ doc: ProjectDoc }>("PUT", `/projects/${id}/storyboard`, { shots }),
  wsUrl: (id: string) =>
    `${BASE.replace(/^http/, "ws")}/ws/projects/${id}?token=${encodeURIComponent(token.get() ?? "")}`,
};
