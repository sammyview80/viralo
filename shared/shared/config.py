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


settings = Settings()
