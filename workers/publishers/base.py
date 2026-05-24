"""Base publisher interface."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class PublishResult:
    success: bool
    platform_post_id: Optional[str] = None
    error: Optional[str] = None
    retry_after_seconds: Optional[int] = None  # set on 429


class BasePublisher(ABC):
    @abstractmethod
    def publish(
        self,
        video_path: str,
        caption: str,
        hashtags: list[str],
        access_token: str,
        refresh_token: Optional[str] = None,
        **kwargs,
    ) -> PublishResult:
        ...

    @abstractmethod
    def refresh_token(self, refresh_token: str) -> dict:
        """Return new token dict with access_token, refresh_token, expires_in."""
        ...
