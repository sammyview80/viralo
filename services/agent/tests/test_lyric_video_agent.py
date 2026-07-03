import os
import sys

agent_path = os.path.join(os.getcwd(), "services/agent")
if agent_path not in sys.path:
    sys.path.append(agent_path)

from agent.lyric_video import plan_lyric_video


def test_transcript_becomes_timed_lyric_lines():
    plan = plan_lyric_video(
        source={"type": "upload", "title": "Demo Song", "artist": "Demo Artist"},
        rights_confirmed=True,
        transcript_text="First line\nSecond line",
        aspect_ratio="16:9",
        template_hint="neon-karaoke",
    )

    assert plan["needs_transcription"] is False
    assert plan["rights"]["status"] == "user_confirmed"
    assert plan["source"]["type"] == "upload"
    assert plan["lyrics"][0]["text"] == "First line"
    assert plan["lyrics"][0]["start_sec"] == 0.0
    assert plan["lyrics"][0]["end_sec"] > plan["lyrics"][0]["start_sec"]
    assert plan["lyrics"][1]["start_sec"] == plan["lyrics"][0]["end_sec"]
    assert plan["template"]["id"] == "neon-karaoke"
    assert plan["template"]["aspect_ratio"] == "16:9"


def test_spotify_source_is_metadata_only_and_needs_audio_or_transcript():
    plan = plan_lyric_video(
        source={"type": "spotify", "url": "https://open.spotify.com/track/abc"},
        rights_confirmed=True,
        transcript_text=None,
        aspect_ratio=None,
        template_hint=None,
    )

    assert plan["source"]["type"] == "spotify"
    assert plan["needs_transcription"] is True
    assert "spotify_metadata_only" in plan["warnings"]
    assert plan["lyrics"] == []


def test_missing_rights_confirmation_adds_warning():
    plan = plan_lyric_video(
        source={"type": "youtube", "url": "https://youtube.com/watch?v=abc12345678"},
        rights_confirmed=False,
        transcript_text="hello world",
        aspect_ratio="9:16",
        template_hint=None,
    )

    assert plan["rights"]["status"] == "unknown"
    assert "rights_not_confirmed" in plan["warnings"]
