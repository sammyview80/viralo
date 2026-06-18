import os
import aiofiles
from pathlib import Path
from shared.storage.base import StorageAdapter

LOCAL_STORAGE_DIR = os.getenv("LOCAL_STORAGE_DIR", "/tmp/viralo-storage")


def _safe_local_path(path: str) -> Path:
    """Resolve a storage-relative path and ensure it stays under LOCAL_STORAGE_DIR."""
    if not path or Path(path).is_absolute():
        raise ValueError("Storage path must be relative")
    base = Path(LOCAL_STORAGE_DIR).resolve()
    target = (base / path).resolve()
    if target != base and base not in target.parents:
        raise ValueError("Storage path escapes local storage root")
    return target


class LocalStorageAdapter(StorageAdapter):
    def __init__(self):
        Path(LOCAL_STORAGE_DIR).mkdir(parents=True, exist_ok=True)

    async def upload(self, data, path: str, content_type: str = "video/mp4") -> str:
        full_path = _safe_local_path(path)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, bytes):
            content = data
        else:
            content = data.read()
        async with aiofiles.open(full_path, "wb") as f:
            await f.write(content)
        return f"/storage/{path.lstrip('/')}"

    async def get_signed_url(self, path: str, expires_in: int = 3600) -> str:
        _safe_local_path(path)
        return f"/storage/{path.lstrip('/')}"

    async def delete(self, path: str) -> None:
        full_path = _safe_local_path(path)
        if full_path.exists():
            full_path.unlink()
