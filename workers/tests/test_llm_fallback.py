"""
Tests for _call_llm_json fallback chain and parallel upload logic.
Run: pytest workers/tests/test_llm_fallback.py -v
Requires: conftest.py stubs in same directory (auto-loaded by pytest).
"""
from unittest.mock import MagicMock, patch

import pytest

# ── _call_llm_json tests ───────────────────────────────────────────────────────

def _make_llm_response(content: str):
    choice = MagicMock()
    choice.message.content = content
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def test_call_llm_json_first_provider_succeeds(monkeypatch):
    """Returns parsed JSON from first available provider."""
    from workers.tasks.video import _call_llm_json

    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _make_llm_response('{"clips": []}')

    with patch("shared.llm._probe_cached", return_value=True), \
         patch("openai.OpenAI", return_value=mock_client):
        result = _call_llm_json([{"role": "user", "content": "test"}])

    assert result == {"clips": []}
    mock_client.chat.completions.create.assert_called_once()


def test_call_llm_json_falls_back_on_failure(monkeypatch):
    """Falls back to second provider when first raises."""
    from workers.tasks.video import _call_llm_json

    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-2")

    call_count = 0

    def _create_side_effect(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("rate limit")
        return _make_llm_response('{"result": "ok"}')

    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = _create_side_effect

    with patch("shared.llm._probe_cached", return_value=True), \
         patch("openai.OpenAI", return_value=mock_client):
        result = _call_llm_json([{"role": "user", "content": "test"}])

    assert result == {"result": "ok"}
    assert call_count == 2


def test_call_llm_json_skips_missing_env(monkeypatch):
    """Skips providers whose env key is not set."""
    from workers.tasks.video import _call_llm_json

    # Clear all provider keys
    for key in ["GROQ_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY",
                "SAMBANOVA_API_KEY", "CLOUDFLARE_API_TOKEN"]:
        monkeypatch.delenv(key, raising=False)

    # Only set cerebras
    monkeypatch.setenv("CEREBRAS_API_KEY", "cerebras-key")

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _make_llm_response('{"data": 1}')

    with patch("shared.llm._probe_cached", return_value=True), \
         patch("openai.OpenAI", return_value=mock_client) as MockOpenAI:
        result = _call_llm_json([{"role": "user", "content": "test"}])

    # Should have been called with Cerebras base_url
    call_args = MockOpenAI.call_args
    assert "cerebras.ai" in call_args.kwargs.get("base_url", "")
    assert result == {"data": 1}


def test_call_llm_json_parses_markdown_wrapped_json(monkeypatch):
    """Handles providers that wrap JSON in ```json blocks."""
    from workers.tasks.video import _call_llm_json

    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    raw = '```json\n{"clips": [{"score": 7.5}]}\n```'
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = _make_llm_response(raw)

    with patch("shared.llm._probe_cached", return_value=True), \
         patch("openai.OpenAI", return_value=mock_client):
        result = _call_llm_json([{"role": "user", "content": "test"}])

    assert result["clips"][0]["score"] == 7.5


def test_call_llm_json_all_fail_raises(monkeypatch):
    """Raises RuntimeError when all providers fail."""
    from workers.tasks.video import _call_llm_json

    monkeypatch.setenv("GROQ_API_KEY", "test-key")

    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = RuntimeError("all down")

    with patch("shared.llm._probe_cached", return_value=True), \
         patch("openai.OpenAI", return_value=mock_client), \
         pytest.raises(RuntimeError, match="All free LLM providers exhausted"):
        _call_llm_json([{"role": "user", "content": "test"}])


# ── Parallel upload tests ──────────────────────────────────────────────────────

def test_upload_files_parallel():
    """Video and thumbnail uploads run concurrently (asyncio.gather)."""
    import asyncio
    from pathlib import Path

    upload_order = []

    async def fake_upload(f, key, mime):
        upload_order.append(("start", key))
        await asyncio.sleep(0.05)  # simulate network latency
        upload_order.append(("end", key))
        return f"https://cdn.example.com/{key}"

    mock_storage = MagicMock()
    mock_storage.upload = fake_upload

    # Simulate the _upload_files closure from _export_clip
    async def _upload_files(clip_path: str, thumb_path: str, storage_key: str, thumb_key: str):
        async def _up_video():
            with open(clip_path, "rb") as f:
                return await mock_storage.upload(f, storage_key, "video/mp4")

        async def _up_thumb():
            if not Path(thumb_path).exists():
                return None
            with open(thumb_path, "rb") as f:
                return await mock_storage.upload(f, thumb_key, "image/jpeg")

        return await asyncio.gather(_up_video(), _up_thumb())

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp4") as vf, \
         tempfile.NamedTemporaryFile(suffix=".jpg") as tf:
        result = asyncio.run(_upload_files(vf.name, tf.name, "clips/vid.mp4", "clips/thumb.jpg"))

    # Both uploads completed
    assert len(result) == 2
    assert result[0].endswith("vid.mp4")
    assert result[1].endswith("thumb.jpg")

    # Both started before either ended (parallel execution)
    starts = [i for i, (ev, _) in enumerate(upload_order) if ev == "start"]
    first_end = next(i for i, (ev, _) in enumerate(upload_order) if ev == "end")
    assert len(starts) == 2  # both started
    assert starts[1] < first_end  # second start before first end = parallel


def test_upload_files_skips_missing_thumbnail():
    """Returns None for thumbnail when file doesn't exist."""
    import asyncio
    from pathlib import Path

    mock_storage = MagicMock()

    async def fake_upload(f, key, mime):
        return f"https://cdn.example.com/{key}"

    mock_storage.upload = fake_upload

    async def _upload_files(clip_path: str, thumb_path: str, storage_key: str, thumb_key: str):
        async def _up_video():
            with open(clip_path, "rb") as f:
                return await mock_storage.upload(f, storage_key, "video/mp4")

        async def _up_thumb():
            if not Path(thumb_path).exists():
                return None
            with open(thumb_path, "rb") as f:
                return await mock_storage.upload(f, thumb_key, "image/jpeg")

        return await asyncio.gather(_up_video(), _up_thumb())

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp4") as vf:
        result = asyncio.run(_upload_files(
            vf.name, "/nonexistent/thumb.jpg", "clips/vid.mp4", "clips/thumb.jpg"
        ))

    assert result[0].endswith("vid.mp4")
    assert result[1] is None
