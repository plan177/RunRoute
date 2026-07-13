import hashlib
import hmac
import json
import logging
from time import time
from urllib.parse import unquote, parse_qsl

from fastapi import HTTPException, Request

from .config import get_settings

logger = logging.getLogger(__name__)


class TelegramAuthError(Exception):
    pass


def parse_init_data(init_data: str) -> dict[str, str]:
    parsed = {}
    for pair in init_data.split("&"):
        if "=" not in pair:
            continue
        key, value = pair.split("=", 1)
        parsed[unquote(key)] = unquote(value)
    return parsed


def verify_telegram_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400) -> dict:
    if not init_data:
        raise TelegramAuthError("Missing init data")
    if not bot_token:
        raise TelegramAuthError("Bot token not configured")

    parsed = parse_init_data(init_data)

    hash_value = parsed.pop("hash", None)
    if not hash_value:
        raise TelegramAuthError("Missing hash in init data")

    auth_date_str = parsed.get("auth_date")
    if not auth_date_str:
        raise TelegramAuthError("Missing auth_date")

    try:
        auth_date = int(auth_date_str)
    except (ValueError, TypeError):
        raise TelegramAuthError("Invalid auth_date")

    now = int(time())
    if auth_date > now + 300:
        raise TelegramAuthError("auth_date is in the future")
    if now - auth_date > max_age_seconds:
        raise TelegramAuthError("auth_date is expired")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))

    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calculated_hash, hash_value):
        raise TelegramAuthError("Invalid signature")

    user_json = parsed.get("user")
    if not user_json:
        raise TelegramAuthError("Missing user in init data")

    try:
        user = json.loads(user_json)
    except (json.JSONDecodeError, TypeError):
        raise TelegramAuthError("Invalid user data")

    if "id" not in user:
        raise TelegramAuthError("Missing user id")

    return {
        "id": user["id"],
        "username": user.get("username"),
        "first_name": user.get("first_name", ""),
        "last_name": user.get("last_name", ""),
        "language_code": user.get("language_code"),
        "photo_url": user.get("photo_url"),
        "auth_date": auth_date,
    }


async def get_current_telegram_user(request: Request) -> dict:
    init_data = request.headers.get("X-Telegram-Init-Data")
    if not init_data:
        raise HTTPException(status_code=401, detail="Missing Telegram init data")

    settings = get_settings()
    bot_token = settings.BOT_TOKEN.get_secret_value()
    max_age = settings.TELEGRAM_AUTH_MAX_AGE_SECONDS

    try:
        return verify_telegram_init_data(init_data, bot_token, max_age)
    except TelegramAuthError:
        raise HTTPException(status_code=401, detail="Invalid Telegram init data")
