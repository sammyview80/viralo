from pathlib import Path
from unittest.mock import Mock

from workers.tasks import video


def test_editor_precise_trim_command_cuts_audio_and_video_from_same_source_point(tmp_path):
    source = tmp_path / "source.mp4"
    output = tmp_path / "trimmed.mp4"

    cmd = video._build_precise_trim_command(
        source_path=str(source),
        output_path=str(output),
        start_sec=12.345,
        end_sec=20.345,
        has_audio=True,
    )

    filters = cmd[cmd.index("-filter_complex") + 1]
    assert cmd[cmd.index("-ss") + 1] == "10.345"
    assert "trim=start=2.0:duration=7.999999999999998,setpts=PTS-STARTPTS[vout]" in filters
    assert "atrim=start=2.0:duration=7.999999999999998,asetpts=PTS-STARTPTS[aout]" in filters
    assert "-c" not in cmd
    assert "copy" not in cmd


def test_editor_precise_trim_command_handles_silent_sources(tmp_path):
    source = tmp_path / "source.mp4"
    output = tmp_path / "trimmed.mp4"

    cmd = video._build_precise_trim_command(
        source_path=str(source),
        output_path=str(output),
        start_sec=3.0,
        end_sec=None,
        has_audio=False,
    )

    filters = cmd[cmd.index("-filter_complex") + 1]
    assert "[0:a:0]" not in filters
    assert "-map" in cmd
    assert "[vout]" in cmd
    assert "[aout]" not in cmd


def test_sound_marker_mix_handles_silent_source_without_base_audio(monkeypatch, tmp_path):
    sounds_dir = tmp_path / "sounds"
    sounds_dir.mkdir()
    (sounds_dir / "ding.wav").write_bytes(b"fake")
    monkeypatch.setattr(video, "SOUNDS_DIR", sounds_dir)

    cmd = video._mix_sound_markers(
        source_path=str(tmp_path / "silent.mp4"),
        markers=[{"sound": "ding", "time_ms": 2500}],
        output_path=str(tmp_path / "out.mp4"),
        base_cmd_prefix=["-crf", "22"],
        source_has_audio=False,
    )

    filters = cmd[cmd.index("-filter_complex") + 1]
    assert "[0:a]" not in filters
    assert "adelay=2500|2500" in filters
    assert "amix=inputs=1" in filters


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
    assert cmd[cmd.index("-ss") + 1] == "10.345"
    assert "trim=start=2.0:duration=7.999999999999998,setpts=PTS-STARTPTS" in filters
    assert "atrim=start=2.0:duration=7.999999999999998,asetpts=PTS-STARTPTS" in filters
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
    assert cmd[cmd.index("-ss") + 1] == "6.25"
    assert "trim=start=2.0:duration=6.5,setpts=PTS-STARTPTS" in filters
    assert "atrim=start=2.0:duration=6.5,asetpts=PTS-STARTPTS" in filters
