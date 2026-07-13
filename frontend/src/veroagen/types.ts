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
  image_model?: string | null;
  video_model?: string | null;
}

export interface Character {
  id: string; name: string; description: string;
  ref_image_url: string | null;
  ref_status: "none" | "generating" | "ready" | "failed";
  error?: string | null;
}

export interface ChatMessage { role: "user" | "assistant" | "system"; content: string }

export interface TimelineClip {
  id: string; shot_id: string; in_s: number; out_s: number; order: number;
}
export interface AudioClip {
  id: string; asset_url: string; label: string; start_s: number; gain_db: number;
}
export interface Timeline { video: TimelineClip[]; voice: AudioClip[]; music: AudioClip[] }
export interface RenderState {
  status: "none" | "rendering" | "ready" | "failed";
  url: string | null; error: string | null;
}

export interface ProjectDoc {
  title: string;
  script: { scenes: Scene[] };
  storyboard: { shots: Shot[] };
  chat: { messages: ChatMessage[] };
  characters: { items: Character[] };
  assets: { items: unknown[] };
  timeline: Timeline;
  render: RenderState;
  version: number;
}

export interface ProjectSummary { id: string; title: string; version: number }

export interface ModelOption { id: string; label: string }
export interface ModelCatalog {
  image_models: ModelOption[];
  video_models: ModelOption[];
  camera_presets: string[];
}
export interface CreditsInfo { balance: number; period: string; costs: Record<string, number> }
