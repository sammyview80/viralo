from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str
    rabbitmq_url: str
    secret_key: str
    encryption_key: str = ""
    environment: str = "development"
    debug: bool = True
    app_domain: str = "localhost"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    trusted_proxy_ips: str = ""
    viralo_api_key: str = ""

    frontend_url: str = "http://localhost:5173"
    admin_token_expire_minutes: int = 720
    # Distinct signing secret for admin JWTs so they can't be forged by anything
    # that can mint a normal user access/refresh token with secret_key. No
    # fallback: admin login/verify endpoints raise a clear 500 until this is
    # set to a real, independent random value (see .env.example).
    admin_jwt_secret: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    # env var is SMTP_PASS (matches .env.example and workers/tasks/notification.py's
    # convention) - without this alias, pydantic-settings looks for SMTP_PASSWORD
    # instead, silently resolves to "", and SMTP auth fails with a misleading
    # Gmail 535 "Bad Credentials" even though the actual password is correct.
    smtp_password: str = Field(default="", validation_alias="SMTP_PASS")
    smtp_from: str = "Viralo <no-reply@viralo.app>"


settings = Settings()
