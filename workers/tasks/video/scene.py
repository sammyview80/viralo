"""
Stage 4b: Scene frame extraction.
Samples keyframes at uniform intervals using PyAV. No ffmpeg required.
"""
import logging
import os
from pathlib import Path

from workers.tasks.video._core import SceneFrame

__all__ = ['_extract_scene_frames', '_save_scene_frames']

log = logging.getLogger(__name__)


def _extract_scene_frames(
    source_path: str,
    duration: float,
    n_frames: int = 12,
    tmp_dir: str = "/tmp/viralo-video",
) -> list[SceneFrame]:
    """
    Extract n_frames evenly-spaced keyframes from source_path.
    Returns SceneFrame list with local paths; returns [] on any error.
    """
    import av
    try:
        Path(tmp_dir).mkdir(parents=True, exist_ok=True)
        if duration <= 0 or n_frames <= 0:
            return []

        interval = duration / (n_frames + 1)
        target_times = [interval * (i + 1) for i in range(n_frames)]
        frames: list[SceneFrame] = []

        with av.open(source_path) as container:
            video = next((s for s in container.streams if s.type == "video"), None)
            if video is None:
                return []
            video.thread_type = "AUTO"
            for target_t in target_times:
                try:
                    container.seek(int(target_t * 1_000_000), stream=video)
                    for frame in container.decode(video=0):
                        img = frame.to_image()
                        out_path = os.path.join(tmp_dir, f"scene_{target_t:.2f}.jpg")
                        img.save(out_path, "JPEG", quality=75)
                        frames.append(SceneFrame(time_sec=round(target_t, 2), path=out_path))
                        break
                except Exception as e:
                    log.debug("scene frame skip t=%.1f: %s", target_t, e)
                    continue
        return frames
    except Exception as e:
        log.warning("_extract_scene_frames failed: %s", e)
        return []


def _save_scene_frames(
    tenant_id: str,
    video_id: str,
    frames: list[SceneFrame],
    engine,
) -> None:
    """Persist scene frames metadata to DB. Storage upload happens async elsewhere."""
    if not frames:
        return
    from sqlalchemy import text
    import uuid as _uuid
    rows = [
        {"id": str(_uuid.uuid4()), "tenant_id": tenant_id, "video_id": video_id,
         "time_sec": f.time_sec, "storage_url": None}
        for f in frames
    ]
    try:
        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO scene_frames (id, tenant_id, video_id, time_sec, storage_url)
                    VALUES (:id, CAST(:tenant_id AS uuid), CAST(:video_id AS uuid), :time_sec, :storage_url)
                    ON CONFLICT DO NOTHING
                """),
                rows,
            )
    except Exception as e:
        log.warning("_save_scene_frames DB write failed: %s", e)
