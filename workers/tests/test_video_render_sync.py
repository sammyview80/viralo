from pathlib import Path
from unittest.mock import Mock

from workers.tasks import video


def _ok_run(cmd, *args, **kwargs):
    output = cmd[-1]
    Path(output).write_bytes(b"0" * 2048)
    return Mock(returncode=0, stderr="")


def test_no_caption_render_reencodes_and_uses_exact_seek_after_input(monkeypatch, tmp_path):
    commands = []

    def fake_run(cmd, *args, **kwargs):
        commands.append(cmd)
        return _ok_run(cmd, *args, **kwargs)

    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    output = tmp_path / "clip.mp4"
    monkeypatch.setattr(video.subprocess, "run", fake_run)

    video._render_clip_streamcopy(
        source_path=str(source),
        clip=video.ClipResult(start=12.345, end=20.345, score=1, title="t", reason="r"),
        output_path=str(output),
        target_width=1280,
        target_height=720,
        crop_mode=None,
        meta=video.VideoMeta(
            duration=60,
            width=1280,
            height=720,
            fps=30,
            codec="h264",
            has_audio=True,
            audio_sample_rate=48000,
            audio_channels=2,
        ),
    )

    cmd = commands[0]
    filters = cmd[cmd.index("-filter_complex") + 1]
    assert "trim=start=12.345:duration=7.999999999999998,setpts=PTS-STARTPTS" in filters
    assert "atrim=start=12.345:duration=7.999999999999998,asetpts=PTS-STARTPTS" in filters
    assert "copy" not in cmd[cmd.index("-c:v") + 1]


def test_caption_pass1_uses_exact_seek_after_input(monkeypatch, tmp_path):
    commands = []

    def fake_run(cmd, *args, **kwargs):
        commands.append(cmd)
        return _ok_run(cmd, *args, **kwargs)

    source = tmp_path / "source.webm"
    source.write_bytes(b"source")
    output = tmp_path / "clip.mp4"
    monkeypatch.setattr(video.subprocess, "run", fake_run)
    monkeypatch.setattr(video, "_render_clip", lambda **kwargs: Path(kwargs["output_path"]).write_bytes(b"1" * 2048))

    video._render_clip_ffmpeg_captions(
        source_path=str(source),
        clip=video.ClipResult(start=8.25, end=14.75, score=1, title="t", reason="r"),
        output_path=str(output),
        captions=[],
        target_width=720,
        target_height=1280,
        crop_mode="9:16",
        meta=video.VideoMeta(
            duration=60,
            width=1920,
            height=1080,
            fps=30,
            codec="vp9",
            has_audio=True,
            audio_sample_rate=48000,
            audio_channels=2,
        ),
    )

    cmd = commands[0]
    filters = cmd[cmd.index("-filter_complex") + 1]
    assert "trim=start=8.25:duration=6.5,setpts=PTS-STARTPTS" in filters
    assert "atrim=start=8.25:duration=6.5,asetpts=PTS-STARTPTS" in filters
