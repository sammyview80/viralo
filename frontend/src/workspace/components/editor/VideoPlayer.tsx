import { RefObject } from "react";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface VideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  playing: boolean;
  currentTime: number;
  duration: number;
  thumbnailUrl?: string;
  storageUrl?: string;
  onTogglePlay: () => void;
  onSeekDelta: (deltaSec: number) => void;
  onTimeUpdate: (t: number) => void;
  onEnded: () => void;
  onLoadedMetadata: (duration: number) => void;
}

export function VideoPlayer({
  videoRef,
  canvasRef,
  playing,
  currentTime,
  duration,
  thumbnailUrl,
  storageUrl,
  onTogglePlay,
  onSeekDelta,
  onTimeUpdate,
  onEnded,
  onLoadedMetadata,
}: VideoPlayerProps) {
  return (
    <div className="flex flex-col items-center gap-4 h-full justify-center py-6">
      {/* 9:16 preview */}
      <div
        className="relative overflow-hidden rounded-[20px] bg-black shadow-[0_0_0_2px_rgba(255,255,255,.08),0_20px_60px_rgba(0,0,0,.8)]"
        style={{ width: 180, aspectRatio: "9/16" }}
      >
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {storageUrl && (
          <video
            ref={videoRef}
            src={storageUrl}
            crossOrigin="anonymous"
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
            onTimeUpdate={(e) => onTimeUpdate((e.target as HTMLVideoElement).currentTime)}
            onEnded={onEnded}
            onLoadedMetadata={(e) => {
              const v = e.target as HTMLVideoElement;
              if (v.duration && isFinite(v.duration)) onLoadedMetadata(v.duration);
            }}
          />
        )}
        <canvas
          ref={canvasRef}
          width={360}
          height={640}
          className="absolute inset-0 h-full w-full"
        />
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onSeekDelta(-5)}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05] text-zinc-400 hover:bg-white/[.09] hover:text-white transition cursor-pointer text-[11px] font-bold"
        >
          −5
        </button>
        <button
          onClick={onTogglePlay}
          className="grid h-12 w-12 place-items-center rounded-full bg-[#ff3d6a] text-white shadow-lg hover:bg-[#e8304f] transition cursor-pointer"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={() => onSeekDelta(5)}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05] text-zinc-400 hover:bg-white/[.09] hover:text-white transition cursor-pointer text-[11px] font-bold"
        >
          +5
        </button>
      </div>

      <div className="font-mono text-[12px] text-zinc-500">
        {fmt(currentTime)} / {fmt(duration)}
      </div>
    </div>
  );
}
