import { token } from "@/lib/api";
import type { ProjectDoc, ProjectSummary, Scene, Shot, TimelineClip } from "./types";

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
  createCharacter: (id: string, name: string, description: string) =>
    req<{ doc: ProjectDoc }>("POST", `/projects/${id}/characters`, { name, description }),
  generateRef: (id: string, characterId: string) =>
    req<{ status: string }>("POST", `/projects/${id}/characters/${characterId}/generate-ref`),
  generateShotImage: (id: string, shotId: string) =>
    req<{ status: string }>("POST", `/projects/${id}/shots/${shotId}/generate-image`),
  generateShotVideo: (id: string, shotId: string) =>
    req<{ status: string }>("POST", `/projects/${id}/shots/${shotId}/generate-video`),
  putTimeline: (id: string, timeline: { video: TimelineClip[] }) =>
    req<{ doc: ProjectDoc }>("PUT", `/projects/${id}/timeline`, { timeline }),
  buildDefaultTimeline: (id: string) =>
    req<{ doc: ProjectDoc }>("POST", `/projects/${id}/timeline/default`),
  queueVoiceover: (id: string) =>
    req<{ status: string }>("POST", `/projects/${id}/voiceover`),
  queueMusic: (id: string, prompt: string) =>
    req<{ status: string }>("POST", `/projects/${id}/music`, { prompt }),
  queueRender: (id: string) =>
    req<{ status: string }>("POST", `/projects/${id}/render`),
  mediaUrl: (path: string) => `${BASE}${path}`,
};
