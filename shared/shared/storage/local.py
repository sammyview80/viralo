import os
import aiofiles
from pathlib import Path
from shared.storage.base import StorageAdapter

LOCAL_STORAGE_DIR = os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage")


class LocalStorageAdapter(StorageAdapter):
    def __init__(self):
        Path(LOCAL_STORAGE_DIR).mkdir(parents=True, exist_ok=True)

    async def upload(self, data, path: str, content_type: str = "video/mp4") -> str:
        full_path = Path(LOCAL_STORAGE_DIR) / path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, bytes):
            content = data
        else:
            content = data.read()
        async with aiofiles.open(full_path, "wb") as f:
            await f.write(content)
        return f"/storage/{path}"

    async def get_signed_url(self, path: str, expires_in: int = 3600) -> str:
        return f"/storage/{path}"

    async def delete(self, path: str) -> None:
        full_path = Path(LOCAL_STORAGE_DIR) / path
        if full_path.exists():
            full_path.unlink()
