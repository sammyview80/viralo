"""Pipeline honors explicit language and skip_caption."""
from unittest.mock import patch

from workers.tasks.video.pipeline import _resolve_pipeline_language, _run_ai_content_step


def test_explicit_language_skips_whisper_auto_detect():
    cfg = {"language": "ja"}
    lang = _resolve_pipeline_language(cfg, whisper_lang="en", meta_lang="ko")
    assert lang == "ja"


def test_missing_language_uses_whisper_then_meta():
    cfg = {}
    assert _resolve_pipeline_language(cfg, whisper_lang="fr") == "fr"
    assert _resolve_pipeline_language(cfg, meta_lang="de") == "de"
    assert _resolve_pipeline_language(cfg, whisper_lang="fr", meta_lang="de") == "fr"


def test_skip_caption_skips_batch_ai_content():
    clips, words, captions, platforms = [], [], {}, ["tiktok"]
    with patch("workers.tasks.video.pipeline._batch_ai_content") as mock_batch:
        result = _run_ai_content_step(
            {"skip_caption": True},
            clips,
            words,
            captions,
            platforms,
            language="en",
        )
        mock_batch.assert_not_called()
        assert result == {}


def test_transcribe_with_cfg_skips_translate_when_language_set():
    with patch("workers.tasks.video.pipeline._transcribe", return_value=([], "ja")) as mock_transcribe:
        from workers.tasks.video.pipeline import _transcribe_with_cfg

        _transcribe_with_cfg("/tmp/x.mp4", 10.0, "ja", {"language": "ja"})
        mock_transcribe.assert_called_once_with(
            "/tmp/x.mp4", 10.0, "ja", translate_to_english=False,
        )


def test_transcribe_with_cfg_translates_when_language_auto():
    with patch("workers.tasks.video.pipeline._transcribe", return_value=([], "hi")) as mock_transcribe:
        from workers.tasks.video.pipeline import _transcribe_with_cfg

        _transcribe_with_cfg("/tmp/x.mp4", 10.0, "auto", {})
        mock_transcribe.assert_called_once_with(
            "/tmp/x.mp4", 10.0, "auto", translate_to_english=True,
        )


def test_skip_caption_false_calls_batch_ai_content():
    clips, words, captions, platforms = [], [], {}, ["tiktok"]
    with patch("workers.tasks.video.pipeline._batch_ai_content", return_value={0: {}}) as mock_batch:
        result = _run_ai_content_step(
            {"skip_caption": False},
            clips,
            words,
            captions,
            platforms,
            language="ko",
        )
        mock_batch.assert_called_once()
        assert mock_batch.call_args.kwargs["language"] == "ko"
        assert result == {0: {}}
