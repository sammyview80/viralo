"""Tests for the occasion-aware template system and audio mixing."""
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from workers.tasks.templates import (
    OCCASION_TEMPLATE,
    TEMPLATES,
    resolve_template,
)


# ── Template registry ─────────────────────────────────────────────────────────

class TestResolveTemplate:
    def test_football_maps_to_sports_hype(self):
        spec = resolve_template("football")
        assert spec == TEMPLATES["sports-hype"]

    def test_soccer_alias(self):
        assert resolve_template("soccer") == TEMPLATES["sports-hype"]

    def test_gaming_maps_to_gaming_clutch(self):
        assert resolve_template("gaming") == TEMPLATES["gaming-clutch"]

    def test_podcast_maps_to_talking_head(self):
        assert resolve_template("podcast") == TEMPLATES["talking-head"]

    def test_cricket_maps_to_sports_hype(self):
        assert resolve_template("cricket") == TEMPLATES["sports-hype"]

    def test_ufc_maps_to_sports_hype(self):
        assert resolve_template("ufc") == TEMPLATES["sports-hype"]

    def test_concert_maps_to_music_vibe(self):
        assert resolve_template("concert") == TEMPLATES["music-vibe"]

    def test_wedding_maps_to_cinematic(self):
        assert resolve_template("wedding") == TEMPLATES["cinematic"]

    def test_unknown_occasion_falls_back_to_generic(self):
        assert resolve_template("unknown_thing") == TEMPLATES["generic"]

    def test_none_occasion_falls_back_to_generic(self):
        assert resolve_template(None) == TEMPLATES["generic"]

    def test_explicit_override_wins_over_occasion(self):
        spec = resolve_template("football", template_id_override="generic")
        assert spec == TEMPLATES["generic"]

    def test_invalid_override_falls_back_to_occasion(self):
        spec = resolve_template("football", template_id_override="nonexistent")
        assert spec == TEMPLATES["sports-hype"]

    def test_returns_copy_not_reference(self):
        s1 = resolve_template("football")
        s2 = resolve_template("football")
        s1["music_track"] = "mutated"
        assert s2["music_track"] == TEMPLATES["sports-hype"]["music_track"]

    def test_sports_hype_has_hook_overlay(self):
        spec = resolve_template("football")
        assert spec["hook_overlay"] is True

    def test_generic_has_no_hook_overlay(self):
        spec = resolve_template("general")
        assert spec["hook_overlay"] is False

    def test_all_templates_have_required_keys(self):
        required = {"caption_style", "hook_overlay", "hook_duration_sec",
                    "voiceover", "music_track", "punch_zoom", "background_style"}
        for name, spec in TEMPLATES.items():
            missing = required - spec.keys()
            assert not missing, f"Template '{name}' missing keys: {missing}"

    # ── new occasion mappings ──

    def test_mma_maps_to_sports_hype(self):
        assert resolve_template("mma") == TEMPLATES["sports-hype"]

    def test_boxing_maps_to_sports_hype(self):
        assert resolve_template("boxing") == TEMPLATES["sports-hype"]

    def test_f1_maps_to_sports_hype(self):
        assert resolve_template("f1") == TEMPLATES["sports-hype"]

    def test_racing_maps_to_sports_hype(self):
        assert resolve_template("racing") == TEMPLATES["sports-hype"]

    def test_music_maps_to_music_vibe(self):
        assert resolve_template("music") == TEMPLATES["music-vibe"]

    def test_travel_maps_to_cinematic(self):
        assert resolve_template("travel") == TEMPLATES["cinematic"]

    def test_interview_maps_to_talking_head(self):
        assert resolve_template("interview") == TEMPLATES["talking-head"]

    def test_esports_maps_to_gaming_clutch(self):
        assert resolve_template("esports") == TEMPLATES["gaming-clutch"]

    # ── background_style values ──

    def test_sports_hype_uses_blur_fill(self):
        assert resolve_template("football")["background_style"] == "blur_fill"

    def test_cinematic_uses_blur_fill(self):
        assert resolve_template("wedding")["background_style"] == "blur_fill"

    def test_music_vibe_uses_blur_fill(self):
        assert resolve_template("concert")["background_style"] == "blur_fill"

    def test_gaming_clutch_uses_center_crop(self):
        assert resolve_template("gaming")["background_style"] == "center_crop"

    def test_generic_uses_center_crop(self):
        assert resolve_template("general")["background_style"] == "center_crop"

    def test_all_background_styles_are_valid(self):
        valid = {"blur_fill", "center_crop"}
        for name, spec in TEMPLATES.items():
            assert spec["background_style"] in valid, \
                f"Template '{name}' has unknown background_style: {spec['background_style']}"

    # ── new template specs ──

    def test_cinematic_template_has_dramatic_music(self):
        assert TEMPLATES["cinematic"]["music_track"] == "dramatic"

    def test_music_vibe_template_has_hype_music(self):
        assert TEMPLATES["music-vibe"]["music_track"] == "hype"

    def test_cinematic_has_hook_overlay(self):
        assert TEMPLATES["cinematic"]["hook_overlay"] is True

    def test_music_vibe_has_no_voiceover(self):
        # concert clips: music not narration
        assert TEMPLATES["music-vibe"]["voiceover"] is False


# ── video.py helpers (require Python 3.10+ union syntax — run in Docker) ──────

try:
    from workers.tasks.video import _make_hook_text, _mix_audio_tracks, _synthesize_voiceover
    _VIDEO_IMPORTABLE = True
except Exception:
    _VIDEO_IMPORTABLE = False

video_only = pytest.mark.skipif(not _VIDEO_IMPORTABLE, reason="workers.tasks.video requires Python 3.10+ or Docker env")


@video_only
class TestMakeHookText:
    def test_uppercase(self):
        result = _make_hook_text("messi scores an incredible goal")
        assert result == result.upper()

    def test_truncates_to_six_words(self):
        result = _make_hook_text("one two three four five six seven eight")
        assert len(result.split()) <= 6

    def test_empty_title_returns_empty(self):
        assert _make_hook_text("") == ""

    def test_max_38_chars(self):
        long = "a " * 30
        assert len(_make_hook_text(long)) <= 38


@video_only
class TestMixAudioTracks:
    def test_no_music_no_vo_returns_clip_path(self, tmp_path):
        clip = str(tmp_path / "clip.mp4")
        Path(clip).touch()
        result = _mix_audio_tracks(clip, str(tmp_path / "out.mp4"), music_path=None, vo_path=None)
        assert result == clip

    def test_nonexistent_music_treated_as_no_music(self, tmp_path):
        clip = str(tmp_path / "clip.mp4")
        Path(clip).touch()
        result = _mix_audio_tracks(clip, str(tmp_path / "out.mp4"),
                                   music_path="/nonexistent/track.mp3", vo_path=None)
        assert result == clip

    def test_ffmpeg_failure_falls_back_to_clip_path(self, tmp_path):
        clip = str(tmp_path / "clip.mp4")
        music = str(tmp_path / "music.mp3")
        Path(clip).touch()
        Path(music).write_bytes(b"\x00" * 200)
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr=b"ffmpeg error")
            result = _mix_audio_tracks(clip, str(tmp_path / "out.mp4"), music_path=music)
        assert result == clip

    def test_voiceover_mix_pads_audio_to_video_duration(self, tmp_path):
        clip = str(tmp_path / "clip.mp4")
        voiceover = str(tmp_path / "voiceover.mp3")
        out = str(tmp_path / "out.mp4")
        Path(clip).write_bytes(b"\x00" * 200)
        Path(voiceover).write_bytes(b"\x00" * 200)

        commands = []

        def fake_run(cmd, *args, **kwargs):
            commands.append(cmd)
            Path(out).write_bytes(b"\x00" * 2048)
            return MagicMock(returncode=0, stderr=b"")

        with patch("workers.tasks.video.render._media_has_audio_stream", return_value=True), \
             patch("workers.tasks.video.render._media_duration_sec", return_value=8.0), \
             patch("subprocess.run", side_effect=fake_run):
            result = _mix_audio_tracks(clip, out, music_path=None, vo_path=voiceover)

        assert result == out
        filt = commands[0][commands[0].index("-filter_complex") + 1]
        assert "duration=shortest" not in filt
        assert "duration=longest" in filt
        assert "apad,atrim=0:8.0,asetpts=PTS-STARTPTS[aout]" in filt


@video_only
class TestSynthesizeVoiceover:
    def test_empty_script_returns_false(self, tmp_path):
        assert _synthesize_voiceover("", str(tmp_path / "out.mp3")) is False

    def test_edge_tts_not_installed_returns_false(self, tmp_path):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            result = _synthesize_voiceover("test script", str(tmp_path / "out.mp3"))
        assert result is False
