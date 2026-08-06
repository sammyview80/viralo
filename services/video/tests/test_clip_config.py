"""ClipConfig language + skip_caption schema contract."""
import os

import pytest
from pydantic import ValidationError

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://test:test@localhost:5672//")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

from video.schemas import ClipConfig


def test_clip_config_language_and_skip_caption_validate():
    cfg = ClipConfig(language="ja", skip_caption=True)
    assert cfg.language == "ja"
    assert cfg.skip_caption is True


def test_clip_config_model_dump_round_trip():
    cfg = ClipConfig(language="ja", skip_caption=True)
    dumped = cfg.model_dump()
    assert dumped["language"] == "ja"
    assert dumped["skip_caption"] is True
    restored = ClipConfig.model_validate(dumped)
    assert restored.language == "ja"
    assert restored.skip_caption is True


def test_clip_config_defaults_allow_auto_language():
    cfg = ClipConfig()
    assert cfg.language is None
    assert cfg.skip_caption is False


def test_clip_config_add_captions_defaults_false():
    cfg = ClipConfig()
    assert cfg.add_captions is False


def test_skip_caption_independent_of_add_captions():
    cfg = ClipConfig(add_captions=True, skip_caption=True, language="hi")
    assert cfg.add_captions is True
    assert cfg.skip_caption is True
    assert cfg.language == "hi"


def test_clip_config_rejects_unsupported_language():
    with pytest.raises(ValidationError):
        ClipConfig(language="xx")
