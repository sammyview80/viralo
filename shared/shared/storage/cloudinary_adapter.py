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
        # Strip file extension from public_id — Cloudinary appends it automatically
        import os as _os
        public_id = _os.path.splitext(path)[0]
        resource_type = "image" if content_type.startswith("image/") else "video"
        result = cloudinary.uploader.upload(
            content, public_id=public_id, resource_type=resource_type, overwrite=True
        )
        return result["secure_url"]

    async def get_signed_url(self, path: str, expires_in: int = 3600) -> str:
        return cloudinary.utils.cloudinary_url(path, resource_type="video")[0]

    async def download(self, path: str, dest_path: str) -> None:
        import urllib.request
        # path may already be a full https URL (clip_storage_url) or a public_id
        if path.startswith("http://") or path.startswith("https://"):
            url = path
        else:
            url = cloudinary.utils.cloudinary_url(path, resource_type="video")[0]
        if not url:
            raise ValueError(f"Could not resolve download URL for path: {path}")
        urllib.request.urlretrieve(url, dest_path)

    async def delete(self, path: str) -> None:
        cloudinary.uploader.destroy(path, resource_type="video")
