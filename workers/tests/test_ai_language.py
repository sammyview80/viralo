"""LLM prompts honor explicit caption language."""
from unittest.mock import patch

import pytest

from workers.tasks.video._core import ClipResult
from workers.tasks.video.ai import (
    SUPPORTED_CLIP_LANGUAGES,
    _ai_generate_clip_content,
    _language_for_prompt,
    _multi_agent_clip_content,
)


def test_multi_agent_clip_content_includes_lang_instruction_for_korean():
    clip = ClipResult(start=0.0, end=10.0, score=0.8, title="Clip", reason="test", platform="tiktok")
    captured = {}

    def _fake_llm(messages, **kwargs):
        captured["prompt"] = messages[0]["content"]
        return {
            "platforms": {"tiktok": {"description": "desc", "cta": "cta"}},
            "hashtags": {"mega": ["#viral"], "by_platform": {}},
            "best_title": "Title",
            "titles": [],
        }

    with patch("workers.tasks.video.ai._call_llm_json", side_effect=_fake_llm):
        _multi_agent_clip_content(
            clip=clip,
            transcript_snippet="안녕하세요",
            platforms=["tiktok"],
            content_type="other",
            language="ko",
        )

    assert "ko" in captured["prompt"].lower()
    assert "IMPORTANT" in captured["prompt"]


@pytest.mark.parametrize("language", sorted(SUPPORTED_CLIP_LANGUAGES - {"en"}))
def test_language_for_prompt_accepts_supported_codes(language):
    assert _language_for_prompt(language) == language


@pytest.mark.parametrize("language", ["auto", "en", "xx", "ja-JP", "<script>"])
def test_language_for_prompt_rejects_unsupported_codes(language):
    assert _language_for_prompt(language) is None


def test_multi_agent_clip_content_omits_lang_instruction_for_invalid_language():
    clip = ClipResult(start=0.0, end=10.0, score=0.8, title="Clip", reason="test", platform="tiktok")
    captured = {}

    def _fake_llm(messages, **kwargs):
        captured["prompt"] = messages[0]["content"]
        return {
            "platforms": {"tiktok": {"description": "desc", "cta": "cta"}},
            "hashtags": {"mega": ["#viral"], "by_platform": {}},
            "best_title": "Title",
            "titles": [],
        }

    with patch("workers.tasks.video.ai._call_llm_json", side_effect=_fake_llm):
        _multi_agent_clip_content(
            clip=clip,
            transcript_snippet="hello",
            platforms=["tiktok"],
            content_type="other",
            language="not-a-real-lang",
        )

    assert "IMPORTANT" not in captured["prompt"]
    assert "not-a-real-lang" not in captured["prompt"]


def test_ai_generate_clip_content_omits_lang_instruction_for_invalid_language():
    clip = ClipResult(start=0.0, end=10.0, score=0.8, title="Clip", reason="test", platform="tiktok")
    captured = {}

    def _fake_llm(messages, **kwargs):
        captured["prompt"] = messages[0]["content"]
        return {"title": "T", "platforms": {"tiktok": {"description": "d", "tags": []}}}

    with patch("workers.tasks.video.ai._call_llm_json", side_effect=_fake_llm):
        _ai_generate_clip_content(
            clip=clip,
            transcript_snippet="hello",
            platforms=["tiktok"],
            language="xx",
        )

    assert "IMPORTANT" not in captured["prompt"]
    assert "xx" not in captured["prompt"]
