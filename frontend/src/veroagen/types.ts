export interface Scene { id: string; title: string; narration: string }
export interface Shot {
  id: string; scene_id: string; prompt: string;
  camera: string; duration_s: number; status: "draft";
}
export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ProjectDoc {
  title: string;
  script: { scenes: Scene[] };
  storyboard: { shots: Shot[] };
  chat: { messages: ChatMessage[] };
  version: number;
}
export interface ProjectSummary { id: string; title: string; version: number }
