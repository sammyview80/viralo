import os
import cloudinary
import cloudinary.uploader
import cloudinary.utils
from shared.storage.base import StorageAdapter

# cloudinary.uploader._http is a module-level PoolManager singleton created at
# import with maxsize=1. Patch it directly so concurrent uploads don't fill the pool.
try:
    import cloudinary.uploader as _cu
    import cloudinary.utils as _cutils
    import cloudinary as _cld
    _cu._http = _cutils.get_http_connector(
        _cld.config(),
        {**_cld.CERT_KWARGS, "maxsize": 20, "num_pools": 10},
    )
except Exception:
    pass


class CloudinaryAdapter(StorageAdapter):
    def __init__(self):
        cloudinary.config(cloudinary_url=os.getenv("CLOUDINARY_URL", ""))

    async def upload(self, data, path: str, content_type: str = "video/mp4") -> str:
        # Strip file extension from public_id — Cloudinary appends it automatically
        import os as _os
        public_id = _os.path.splitext(path)[0]
        resource_type = "image" if content_type.startswith("image/") else "video"
        if resource_type == "video":
            # upload_large: chunked upload, required for files >100MB (plain
            # upload() hard-fails there) and streams instead of buffering in RAM.
            import io as _io
            src = _io.BytesIO(data) if isinstance(data, bytes) else data
            result = cloudinary.uploader.upload_large(
                src, public_id=public_id, resource_type="video",
                overwrite=True, chunk_size=20_000_000,
            )
        else:
            content = data if isinstance(data, bytes) else data.read()
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
        import os as _os
        import re as _re
        public_id = path
        if path.startswith(("http://", "https://")):
            # Extract public_id from a delivery URL: .../upload/v123/<public_id>.<ext>
            m = _re.search(r"/upload/(?:v\d+/)?(.+)$", path)
            if m:
                public_id = m.group(1)
        # Cloudinary public_ids carry no file extension
        public_id = _os.path.splitext(public_id)[0]
        cloudinary.uploader.destroy(public_id, resource_type="video")
