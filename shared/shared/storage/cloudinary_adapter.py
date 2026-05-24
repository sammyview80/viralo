import os
import cloudinary
import cloudinary.uploader
import cloudinary.utils
from shared.storage.base import StorageAdapter


class CloudinaryAdapter(StorageAdapter):
    def __init__(self):
        cloudinary.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))

    async def upload(self, data, path: str, content_type: str = "video/mp4") -> str:
        content = data if isinstance(data, bytes) else data.read()
        result = cloudinary.uploader.upload(
            content, public_id=path, resource_type="video", overwrite=True
        )
        return result["secure_url"]

    async def get_signed_url(self, path: str, expires_in: int = 3600) -> str:
        return cloudinary.utils.cloudinary_url(path, resource_type="video")[0]

    async def delete(self, path: str) -> None:
        cloudinary.uploader.destroy(path, resource_type="video")
