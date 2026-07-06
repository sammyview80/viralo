export interface Scene { id: string; title: string; narration: string }

export type ShotStatus =
  | "draft" | "image_generating" | "image_ready"
  | "video_generating" | "video_ready" | "failed";

export interface Shot {
  id: string; scene_id: string; prompt: string;
  camera: string; duration_s: number; status: ShotStatus;
  character_id?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  error?: string | null;
}

export interface Character {
  id: string; name: string; description: string;
  ref_image_url: string | null;
  ref_status: "none" | "generating" | "ready" | "failed";
  error?: string | null;
}

export interface ChatMessage { role: "user" | "assistant" | "system"; content: string }

export interface ProjectDoc {
  title: string;
  script: { scenes: Scene[] };
  storyboard: { shots: Shot[] };
  chat: { messages: ChatMessage[] };
  characters: { items: Character[] };
  assets: { items: unknown[] };
  version: number;
}

export interface ProjectSummary { id: string; title: string; version: number }
