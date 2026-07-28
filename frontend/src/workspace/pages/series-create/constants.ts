import type { SeriesOptions } from "@/lib/api";

export const CAPTION_STYLES = [
  { id: "capcut", label: "CapCut", desc: "Clean pill captions, word-by-word highlight" },
  { id: "capcut-bold", label: "CapCut Bold", desc: "Heavier weight, bigger presence" },
  { id: "tiktok", label: "TikTok", desc: "Classic TikTok-style boxed captions" },
  { id: "word-pop", label: "Word Pop", desc: "One big word at a time" },
  { id: "beast", label: "Beast", desc: "Loud MrBeast-style color pops" },
  { id: "neon", label: "Neon", desc: "Glowing neon on dark box" },
  { id: "karaoke", label: "Karaoke", desc: "Words light up as spoken" },
  { id: "minimal", label: "Minimal", desc: "Subtle, clean, no boxes" },
];

export const NICHE_DESCRIPTIONS: Record<string, string> = {
  "crime-heists": "Real criminal cases and heists — meticulous planning, shocking aftermath, justice served or cases gone cold.",
  "scary-stories": "Scary stories that give you goosebumps.",
  "history": "Viral videos about history, from ancient times to the modern day.",
  "greek-mythology": "Shocking and dramatic stories from Greek mythology.",
  "historical-figures": "Life stories in one-minute videos about important historical figures.",
  "true-crime": "Gripping true-crime style mysteries.",
  "stoic-motivation": "Stoic wisdom and motivation with memorable lessons.",
  "good-morals": "Short fable-like stories with a strong moral.",
};

export const FALLBACK_OPTIONS: SeriesOptions = {
  niches: [
    { id: "crime-heists", label: "Crime & Heists" },
    { id: "scary-stories", label: "Scary Stories" },
    { id: "history", label: "History" },
    { id: "greek-mythology", label: "Greek Mythology" },
    { id: "historical-figures", label: "Historical Figures" },
    { id: "true-crime", label: "True Crime" },
    { id: "stoic-motivation", label: "Stoic Motivation" },
    { id: "good-morals", label: "Good Morals" },
  ],
  voices: [
    { id: "en-US-GuyNeural", label: "Guy — deep American male" },
    { id: "en-US-ChristopherNeural", label: "Christopher — calm narrator" },
    { id: "en-US-JennyNeural", label: "Jenny — warm American female" },
    { id: "en-US-AriaNeural", label: "Aria — expressive female" },
    { id: "en-GB-RyanNeural", label: "Ryan — British male" },
    { id: "en-AU-NatashaNeural", label: "Natasha — Australian female" },
  ],
  art_styles: [
    { id: "comic", label: "Comic" },
    { id: "creepy-comic", label: "Creepy Comic" },
    { id: "modern-cartoon", label: "Modern Cartoon" },
    { id: "disney", label: "Disney" },
    { id: "anime", label: "Anime" },
    { id: "realistic", label: "Realistic" },
    { id: "pixel", label: "Pixel" },
    { id: "watercolor", label: "Watercolor" },
  ],
  music_tracks: [
    { id: "hype", label: "Hype — energetic" },
    { id: "dramatic", label: "Dramatic — tense build" },
    { id: "chill", label: "Chill — laid back" },
  ],
  cadences: [
    { id: "daily", label: "Every day" },
    { id: "3x_week", label: "3× per week" },
    { id: "weekly", label: "Once a week" },
  ],
};

export const LANGUAGES = [
  { id: "en", label: "English", flag: "🇬🇧" },
  { id: "es", label: "Spanish", flag: "🇪🇸" },
  { id: "fr", label: "French", flag: "🇫🇷" },
  { id: "de", label: "German", flag: "🇩🇪" },
  { id: "it", label: "Italian", flag: "🇮🇹" },
  { id: "pt", label: "Portuguese", flag: "🇵🇹" },
  { id: "ja", label: "Japanese", flag: "🇯🇵" },
  { id: "ko", label: "Korean", flag: "🇰🇷" },
  { id: "hi", label: "Hindi", flag: "🇮🇳" },
  { id: "zh", label: "Chinese", flag: "🇨🇳" },
];

export const STEPS = [
  { title: "Choose your niche", sub: "Select a preset or describe your own niche" },
  { title: "Language & Voice", sub: "Choose the language and voice style for your video" },
  { title: "Background Music", sub: "Set the mood under the voiceover", optional: true },
  { title: "Art Style", sub: "The visual look of every scene" },
  { title: "Caption Style", sub: "How burned-in captions appear" },
  { title: "Effects", sub: "Extra visual polish", optional: true },
  { title: "Connect Social Accounts", sub: "Where finished videos get posted", optional: true },
  { title: "Series Details", sub: "Name, duration and publish schedule" },
] as const;

export type Draft = {
  name: string;
  niche: string;
  custom_prompt: string;
  example_script: string;
  language: string;
  voice: string;
  music_track: string | null;
  art_style: string;
  caption_style: string;
  effects: Record<string, boolean>;
  duration_sec: number;
  social_account_ids: string[];
  publish_time: string;
  cadence: "daily" | "3x_week" | "weekly";
  auto_publish: boolean;
};

export const DEFAULT_DRAFT: Draft = {
  name: "", niche: "crime-heists", custom_prompt: "", example_script: "",
  language: "en", voice: "en-US-GuyNeural", music_track: null, art_style: "comic",
  caption_style: "capcut", effects: {}, duration_sec: 65, social_account_ids: [],
  publish_time: "18:00", cadence: "daily", auto_publish: true,
};
