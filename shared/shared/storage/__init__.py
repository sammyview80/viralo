from shared.storage.base import StorageAdapter, get_storage
from shared.storage.local import LocalStorageAdapter

__all__ = ["StorageAdapter", "get_storage", "LocalStorageAdapter"]
