import os
from abc import ABC, abstractmethod
from typing import BinaryIO


class StorageAdapter(ABC):
    @abstractmethod
    async def upload(self, data: bytes | BinaryIO, path: str, content_type: str = "video/mp4") -> str:
        """Upload file, return public URL or storage key."""

    @abstractmethod
    async def get_signed_url(self, path: str, expires_in: int = 3600) -> str:
        """Return pre-signed URL for private object."""

    @abstractmethod
    async def delete(self, path: str) -> None:
        """Delete object."""


def get_storage(provider: str = "local") -> StorageAdapter:
    from shared.storage.local import LocalStorageAdapter
    match provider:
        case "r2":
            from shared.storage.r2 import R2Adapter
            return R2Adapter()
        case "s3":
            from shared.storage.s3 import S3Adapter
            return S3Adapter()
        case "cloudinary":
            from shared.storage.cloudinary_adapter import CloudinaryAdapter
            return CloudinaryAdapter()
        case _:
            return LocalStorageAdapter()
