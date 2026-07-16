import hashlib
import hmac
import json
import time
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from httpx import AsyncClient, ASGITransport
from urllib.parse import urlencode
from backend.auth import verify_telegram_init_data, TelegramAuthError


BOT_TOKEN = "test-bot-token-123"


def _make_init_data(user_id=123456, username="testuser", auth_date=None, extra_fields=None):
    if auth_date is None:
        auth_date = int(time.time())

    user_data = {
        "id": user_id,
        "username": username,
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "photo_url": "https://example.com/photo.jpg",
    }
    if extra_fields:
        user_data.update(extra_fields)

    raw = {
        "user": json.dumps(user_data),
        "auth_date": str(auth_date),
    }

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_value = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    raw["hash"] = hash_value
    return urlencode(raw)


def _mock_auth_settings():
    mock = MagicMock()
    mock.BOT_TOKEN = MagicMock()
    mock.BOT_TOKEN.get_secret_value.return_value = BOT_TOKEN
    mock.TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400
    return mock


def test_valid_init_data():
    init_data = _make_init_data()
    result = verify_telegram_init_data(init_data, BOT_TOKEN, max_age_seconds=86400)
    assert result["id"] == 123456
    assert result["username"] == "testuser"
    assert result["first_name"] == "Test"
    assert result["last_name"] == "User"
    assert result["language_code"] == "ru"


def test_invalid_signature():
    init_data = _make_init_data()
    parts = init_data.split("&")
    parts[-1] = "hash=invalidhashvalue"
    tampered = "&".join(parts)

    with pytest.raises(TelegramAuthError, match="Invalid signature"):
        verify_telegram_init_data(tampered, BOT_TOKEN)


def test_missing_hash():
    init_data = _make_init_data()
    parts = [p for p in init_data.split("&") if not p.startswith("hash=")]
    no_hash = "&".join(parts)

    with pytest.raises(TelegramAuthError, match="Missing hash"):
        verify_telegram_init_data(no_hash, BOT_TOKEN)


def test_corrupted_user_json():
    auth_date = int(time.time())
    raw = {
        "user": "not-valid-json{{{",
        "auth_date": str(auth_date),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_value = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    raw["hash"] = hash_value
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user data"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_missing_auth_date():
    user_data = {"id": 123, "username": "u"}
    raw = {"user": json.dumps(user_data)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_value = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    raw["hash"] = hash_value
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Missing auth_date"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_expired_auth_date():
    old_auth_date = int(time.time()) - 200000
    init_data = _make_init_data(auth_date=old_auth_date)

    with pytest.raises(TelegramAuthError, match="expired"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_auth_date_in_future():
    future_auth_date = int(time.time()) + 600
    init_data = _make_init_data(auth_date=future_auth_date)

    with pytest.raises(TelegramAuthError, match="future"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_bot_token_not_in_logs(caplog):
    init_data = _make_init_data()
    try:
        verify_telegram_init_data(init_data, BOT_TOKEN)
    except TelegramAuthError:
        pass
    assert BOT_TOKEN not in caplog.text


def test_init_data_not_in_error_logs(caplog):
    init_data = _make_init_data()
    try:
        verify_telegram_init_data("badData=1&hash=fake", BOT_TOKEN)
    except TelegramAuthError:
        pass
    assert "badData" not in caplog.text


# --- New review tests ---


def test_spaces_and_plus_in_name():
    init_data = _make_init_data(username="user name+test")
    result = verify_telegram_init_data(init_data, BOT_TOKEN)
    assert result["username"] == "user name+test"


def test_percent_encoded_user_json():
    user_data = {"id": 555, "username": "тест", "first_name": "Иван"}
    raw = {
        "user": json.dumps(user_data),
        "auth_date": str(int(time.time())),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_value = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    raw["hash"] = hash_value
    init_data = urlencode(raw)

    result = verify_telegram_init_data(init_data, BOT_TOKEN)
    assert result["id"] == 555
    assert result["username"] == "тест"


def test_duplicate_hash_rejected():
    auth_date = int(time.time())
    user_data = {"id": 1, "username": "u"}
    data_dict = {"user": json.dumps(user_data), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data_dict.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    hash_value = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    data_dict["hash"] = hash_value
    init_data = urlencode(data_dict) + "&hash=duplicate"

    with pytest.raises(TelegramAuthError, match="Duplicate key"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_duplicate_auth_date_rejected():
    auth_date = int(time.time())
    user_data = {"id": 1, "username": "u"}
    raw = {"user": json.dumps(user_data), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw) + "&auth_date=999"

    with pytest.raises(TelegramAuthError, match="Duplicate key"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_duplicate_user_rejected():
    auth_date = int(time.time())
    user_data = {"id": 1, "username": "u"}
    raw = {"user": json.dumps(user_data), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw) + "&user=extra"

    with pytest.raises(TelegramAuthError, match="Duplicate key"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_json_is_list():
    auth_date = int(time.time())
    raw = {"user": "[1,2,3]", "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user data"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_json_is_string():
    auth_date = int(time.time())
    raw = {"user": "\"hello\"", "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user data"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_json_is_null():
    auth_date = int(time.time())
    raw = {"user": "null", "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user data"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_id_missing():
    auth_date = int(time.time())
    raw = {"user": json.dumps({"username": "u"}), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user id"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_id_string():
    auth_date = int(time.time())
    raw = {"user": json.dumps({"id": "abc"}), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user id"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_id_bool():
    auth_date = int(time.time())
    raw = {"user": json.dumps({"id": True}), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user id"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_id_zero():
    auth_date = int(time.time())
    raw = {"user": json.dumps({"id": 0}), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user id"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_id_negative():
    auth_date = int(time.time())
    raw = {"user": json.dumps({"id": -5}), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    init_data = urlencode(raw)

    with pytest.raises(TelegramAuthError, match="Invalid user id"):
        verify_telegram_init_data(init_data, BOT_TOKEN)


def test_user_id_valid_positive_integer():
    init_data = _make_init_data(user_id=42)
    result = verify_telegram_init_data(init_data, BOT_TOKEN)
    assert result["id"] == 42


# --- Endpoint tests ---


@pytest.mark.asyncio
async def test_api_me_no_header():
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/me")
    assert resp.status_code == 401
    assert "init data" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_api_me_invalid_init_data():
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": "bad=1&hash=fake"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_api_me_valid_calls_upsert():
    from backend.main import app
    init_data = _make_init_data(user_id=999, username="validuser")

    mock_user = {
        "id": "00000000-0000-0000-0000-000000000001",
        "telegram_user_id": 999,
        "telegram_username": "validuser",
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "telegram_photo_url": "https://example.com/photo.jpg",
    }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=mock_user)) as mock_upsert, \
         patch("backend.main.get_profile_with_counts", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 200
        body = resp.json()
        assert body["user"]["telegram_user_id"] == 999
        assert body["profile"] is None
        mock_upsert.assert_called_once()


@pytest.mark.asyncio
async def test_api_me_sql_uses_parameters():
    from backend.main import app
    init_data = _make_init_data(user_id=42)

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user") as mock_upsert, \
         patch("backend.main.get_profile_with_counts", return_value=None):
        mock_upsert.return_value = {
            "id": "00000000-0000-0000-0000-000000000002",
            "telegram_user_id": 42,
            "telegram_username": "testuser",
            "first_name": "Test",
            "last_name": "User",
            "language_code": "ru",
            "telegram_photo_url": None,
        }
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 200
        call_kwargs = mock_upsert.call_args
        assert call_kwargs[1]["telegram_user_id"] == 42


@pytest.mark.asyncio
async def test_api_me_duplicate_updates_no_new_row():
    from backend.main import app
    init_data = _make_init_data(user_id=77, username="updated_user")

    call_count = 0
    async def mock_upsert(**kwargs):
        nonlocal call_count
        call_count += 1
        return {
            "id": "00000000-0000-0000-0000-000000000003",
            "telegram_user_id": kwargs["telegram_user_id"],
            "telegram_username": kwargs["username"],
            "first_name": kwargs["first_name"],
            "last_name": kwargs["last_name"],
            "language_code": kwargs["language_code"],
            "telegram_photo_url": kwargs["photo_url"],
        }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", side_effect=mock_upsert), \
         patch("backend.main.get_profile_with_counts", return_value=None):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp1 = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})
            resp2 = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert call_count == 2


@pytest.mark.asyncio
async def test_health_endpoints_still_public():
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for path in ["/health/live", "/health/ready", "/api/health"]:
            resp = await client.get(path)
            assert resp.status_code in (200, 503), f"{path} should be public"


@pytest.mark.asyncio
async def test_api_me_db_error_returns_safe_500():
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", side_effect=Exception("connection refused to db-host:5432")):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 500
        body = resp.json()
        assert "db-host" not in body.get("detail", "")
        assert "5432" not in body.get("detail", "")
        assert "connection refused" not in body.get("detail", "")


@pytest.mark.asyncio
async def test_api_me_db_error_no_sensitive_in_logs(caplog):
    from backend.main import app
    init_data = _make_init_data()

    evil_exc = Exception(
        "password=secret123 host=db.example.com:5432 "
        "initData=ABCDEF hash=deadbeef"
    )

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", side_effect=evil_exc):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})

        assert resp.status_code == 500
        assert "password=secret123" not in caplog.text
        assert "db.example.com" not in caplog.text
        assert "deadbeef" not in caplog.text
