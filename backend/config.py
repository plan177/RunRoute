import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Application
    ENVIRONMENT: str = "development"
    SECRET_KEY: str = ""
    DEBUG: bool = False

    # Telegram
    BOT_TOKEN: str = ""
    WEB_APP_URL: str = "https://run-route-ten.vercel.app"
    FEEDBACK_CHAT_ID: str = ""

    # Database (Supabase PostgreSQL)
    DATABASE_URL: str = ""
    DB_HOST: str = ""
    DB_PORT: int = 5432
    DB_NAME: str = "postgres"
    DB_USER: str = ""
    DB_PASSWORD: str = ""

    # API
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    ALLOWED_ORIGINS: str = "http://localhost:8080,http://localhost:3000"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @property
    def database_url_computed(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        if self.DB_HOST:
            return f"postgresql+asyncpg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        return ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
