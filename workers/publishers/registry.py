"""Publisher registry — get publisher by platform name."""
from .base import BasePublisher
from .youtube import YouTubePublisher
from .instagram import InstagramPublisher
from .tiktok import TikTokPublisher
from .twitter import TwitterPublisher
from .linkedin import LinkedInPublisher
from .facebook import FacebookPublisher

_REGISTRY: dict[str, type[BasePublisher]] = {
    "youtube":   YouTubePublisher,
    "shorts":    YouTubePublisher,
    "instagram": InstagramPublisher,
    "reels":     InstagramPublisher,
    "tiktok":    TikTokPublisher,
    "twitter":   TwitterPublisher,
    "x":         TwitterPublisher,
    "linkedin":  LinkedInPublisher,
    "facebook":  FacebookPublisher,
}


def get_publisher(platform: str) -> BasePublisher:
    cls = _REGISTRY.get(platform.lower())
    if cls is None:
        raise ValueError(f"Unknown platform: {platform}. Supported: {list(_REGISTRY)}")
    return cls()
