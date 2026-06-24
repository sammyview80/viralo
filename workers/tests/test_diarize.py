import os
from unittest.mock import patch, MagicMock
from workers.tasks.video._core import WordTimestamp, SpeakerSegment
from workers.tasks.video.diarize import _diarize_audio, _assign_speakers_to_words


def test_assign_speakers_maps_words():
    words = [
        WordTimestamp(word="Hello", start=0.0, end=0.5),
        WordTimestamp(word="world", start=0.5, end=1.0),
        WordTimestamp(word="Goodbye", start=10.0, end=10.5),
    ]
    segments = [
        SpeakerSegment(start=0.0, end=5.0, speaker_id="SPEAKER_00"),
        SpeakerSegment(start=9.0, end=12.0, speaker_id="SPEAKER_01"),
    ]
    labeled = _assign_speakers_to_words(words, segments)
    assert labeled[0][1] == "SPEAKER_00"
    assert labeled[2][1] == "SPEAKER_01"


def test_diarize_returns_fallback_when_disabled():
    with patch.dict(os.environ, {"SPEAKER_DIARIZATION_ENABLED": "false"}):
        segments = _diarize_audio("/fake/audio.mp3", duration=60.0)
    assert len(segments) == 1
    assert segments[0].speaker_id == "SPEAKER_00"


def test_diarize_pyannote_path():
    with patch.dict(os.environ, {"SPEAKER_DIARIZATION_ENABLED": "true", "HF_TOKEN": "fake"}):
        with patch("workers.tasks.video.diarize._diarize_pyannote") as mock_p:
            mock_p.return_value = [SpeakerSegment(0.0, 60.0, "SPEAKER_00")]
            segs = _diarize_audio("/fake/audio.mp3", duration=60.0)
    assert segs[0].speaker_id == "SPEAKER_00"
