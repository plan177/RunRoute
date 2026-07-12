import os
from functools import lru_cache
from typing import Optional
from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    DATABASE_URL: SecretStr = SecretStr("")
    SUPABASE_URL: SecretStr = SecretStr("")
    SUPABASE_PUBLISHABLE_KEY: SecretStr = SecretStr("")
    SUPABASE_SECRET_KEY: SecretStr = SecretStr("")
    BOT_TOKEN: SecretStr = SecretStr("")
    FEEDBACK_CHAT_ID: str = ""
    WEB_APP_URL: str = "https://run-route-ten.vercel.app"
    SECRET_KEY: SecretStr = SecretStr("")
    ALLOWED_ORIGINS: str = "http://localhost:8080,http://localhost:3000"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_database_url(cls, v):
        if isinstance(v, SecretStr):
            val = v.get_secret_value()
        else:
            val = str(v)
        if val.startswith("postgres://"):
            return SecretStr(val.replace("postgres://", "postgresql://", 1))
        return SecretStr(val) if not isinstance(v, SecretStr) else v

    def validate_required(self) -> list[str]:
        required = {
            "DATABASE_URL": self.DATABASE_URL,
            "SUPABASE_URL": self.SUPABASE_URL,
            "SUPABASE_SECRET_KEY": self.SUPABASE_SECRET_KEY,
            "BOT_TOKEN": self.BOT_TOKEN,
            "SECRET_KEY": self.SECRET_KEY,
        }
        missing = []
        for name, val in required.items():
            if isinstance(val, SecretStr):
                if not val.get_secret_value():
                    missing.append(name)
            elif not val:
                missing.append(name)
        return missing

    def safe_summary(self) -> dict:
        return {
            "environment": self.ENVIRONMENT,
            "database_configured": bool(self.DATABASE_URL.get_secret_value()),
            "supabase_configured": bool(self.SUPABASE_URL.get_secret_value()),
            "bot_configured": bool(self.BOT_TOKEN.get_secret_value()),
        }

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
