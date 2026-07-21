"""Encrypt/decrypt OAuth tokens at rest using Fernet."""
import base64
import os

from cryptography.fernet import Fernet


def _get_fernet() -> Fernet:
    key = os.getenv("ENCRYPTION_KEY", "")
    if not key:
        from shared.config import settings
        if settings.environment != "development":
            raise RuntimeError("ENCRYPTION_KEY must be configured outside development")
        import hashlib

        raw = hashlib.sha256(settings.secret_key.encode()).digest()
        key = base64.urlsafe_b64encode(raw).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_token(token: str) -> str:
    """Encrypt a plaintext token string and return the Fernet ciphertext as a string."""
    return _get_fernet().encrypt(token.encode()).decode()


def decrypt_token(enc: str) -> str:
    """Decrypt a Fernet ciphertext string and return the plaintext token."""
    return _get_fernet().decrypt(enc.encode()).decode()
