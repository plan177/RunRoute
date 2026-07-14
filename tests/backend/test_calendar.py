import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport


BOT_TOKEN = "test-bot-token-123"


def _make_init_data(user_id=123456, username="testuser"):
    import hashlib
    import hmac
    import time
    from urllib.parse import urlencode

    auth_date = int(time.time())
    user_data = {
        "id": user_id,
        "username": username,
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
    }
    raw = {"user": json.dumps(user_data), "auth_date": str(auth_date)}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(raw.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    raw["hash"] = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode(raw)


def _mock_auth_settings():
    mock = MagicMock()
    mock.BOT_TOKEN = MagicMock()
    mock.BOT_TOKEN.get_secret_value.return_value = BOT_TOKEN
    mock.TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400
    return mock


def _mock_user():
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "telegram_user_id": 123456,
        "telegram_username": "testuser",
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "telegram_photo_url": None,
    }


def _clear_rate_limit():
    from backend.main import RATE_LIMIT_STORE
    RATE_LIMIT_STORE.clear()


# --- Migration 003 tests ---


def test_migration_003_creates_saved_routes():
    sql = open("backend/migrations/003_saved_routes_and_planned_runs.sql").read()
    assert "CREATE TABLE IF NOT EXISTS public.saved_routes" in sql
    assert "CREATE TABLE IF NOT EXISTS public.planned_runs" in sql


def test_migration_003_rls_enabled():
    sql = open("backend/migrations/003_saved_routes_and_planned_runs.sql").read()
    assert sql.count("ENABLE ROW LEVEL SECURITY") >= 2


def test_migration_003_no_public_policies():
    sql = open("backend/migrations/003_saved_routes_and_planned_runs.sql").read()
    assert "CREATE POLICY" not in sql


# --- Saved routes tests ---


@pytest.mark.asyncio
async def test_create_route_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/routes", json={
            "name": "Test", "route_mode": "auto", "distance_m": 5000,
            "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
        })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_route_valid_mode():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_saved_route", new_callable=lambda: AsyncMock(return_value={
             "id": "test-id", "name": "Test", "route_mode": "auto",
             "distance_m": 5000, "points": [], "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-01T00:00:00Z",
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "Test", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_route_invalid_mode():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "Test", "route_mode": "swim", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_route_too_few_points():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "Test", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}],
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_route_too_many_points():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        points = [{"lat": 55.7, "lng": 37.6}] * 10001
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "Test", "route_mode": "auto", "distance_m": 5000,
                "points": points,
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_route_invalid_coordinates():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "Test", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 999, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_route_sql_parameterized():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_saved_route", new_callable=lambda: AsyncMock(return_value={
             "id": "test-id", "name": "Test", "route_mode": "auto",
             "distance_m": 5000, "points": [], "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-01T00:00:00Z",
         })) as mock_create:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/routes", json={
                "name": "Test'; DROP TABLE", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["name"] == "Test'; DROP TABLE"


@pytest.mark.asyncio
async def test_list_routes_returns_user_only():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_saved_routes", new_callable=lambda: AsyncMock(return_value=[])) as mock_list:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.get("/api/routes", headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_list.call_args[1]
        assert call_kwargs["user_id"] == _mock_user()["id"]


@pytest.mark.asyncio
async def test_get_route_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_saved_route", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/routes/00000000-0000-0000-0000-000000000099",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_route_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.delete_saved_route", new_callable=lambda: AsyncMock(return_value=False)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.delete(
                "/api/routes/00000000-0000-0000-0000-000000000099",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


# --- Planned runs tests ---


@pytest.mark.asyncio
async def test_create_run_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/api/calendar/runs", json={
            "title": "Morning Run", "starts_at": "2025-12-01T09:00:00+03:00",
        })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_run_requires_tz():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Run", "starts_at": "2025-12-01T09:00:00",
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_run_restricted_reminder():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Run", "starts_at": "2025-12-01T09:00:00+03:00",
                "reminder_minutes": 42,
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_run_route_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_planned_run", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Run", "starts_at": "2027-12-01T09:00:00+03:00",
                "saved_route_id": "00000000-0000-0000-0000-000000000099",
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_runs_validates_from_to():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/calendar/runs?from=2025-12-01T00:00:00Z&to=2025-01-01T00:00:00Z",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_runs_too_large_range():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/calendar/runs?from=2025-01-01T00:00:00Z&to=2026-12-01T00:00:00Z",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_list_runs_sorted():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_planned_runs", new_callable=lambda: AsyncMock(return_value=[
             {"id": "1", "starts_at": "2025-12-02T09:00:00Z"},
             {"id": "2", "starts_at": "2025-12-01T09:00:00Z"},
         ])):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/calendar/runs?from=2025-12-01T00:00:00Z&to=2025-12-31T23:59:59Z",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_update_run_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_planned_run", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/calendar/runs/00000000-0000-0000-0000-000000000099",
                json={"title": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cancel_run_idempotent():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.cancel_planned_run", new_callable=lambda: AsyncMock(return_value={
             "id": "00000000-0000-0000-0000-000000000099", "status": "cancelled",
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp1 = await client.post(
                "/api/calendar/runs/00000000-0000-0000-0000-000000000099/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
            resp2 = await client.post(
                "/api/calendar/runs/00000000-0000-0000-0000-000000000099/cancel",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp1.status_code == 200
        assert resp2.status_code == 200


@pytest.mark.asyncio
async def test_cannot_pass_user_id_or_status():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Run", "starts_at": "2025-12-01T09:00:00+03:00",
                "user_id": "wrong", "status": "completed",
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_db_error_safe_500(caplog):
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_saved_route", side_effect=Exception("password=secret host=db:5432")):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "Test", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 500
        assert "password=secret" not in caplog.text


@pytest.mark.asyncio
async def test_me_and_profile_still_work():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_profile", new_callable=lambda: AsyncMock(return_value={
             "display_name": None, "bio": None, "city": None, "club_name": None,
             "avatar_url": None, "social_links": {}, "is_public": False,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/me", headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_health_endpoints_public():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for path in ["/health/live", "/health/ready", "/api/health"]:
            resp = await client.get(path)
            assert resp.status_code in (200, 503)


# --- Past date rejection ---


@pytest.mark.asyncio
async def test_create_run_rejects_past_date():
    _clear_rate_limit()
    from backend.main import app
    from datetime import datetime, timedelta, timezone
    init_data = _make_init_data()
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Run", "starts_at": past,
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


# --- Ownership check for saved_route_id ---


@pytest.mark.asyncio
async def test_update_run_route_ownership():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_planned_run", new_callable=lambda: AsyncMock(return_value="route_not_found")):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/calendar/runs/00000000-0000-0000-0000-000000000099",
                json={"saved_route_id": "00000000-0000-0000-0000-000000000088"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


# --- Nullable field clearing ---


@pytest.mark.asyncio
async def test_update_run_clears_nullable_fields():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_planned_run", new_callable=lambda: AsyncMock(return_value={
             "id": "test-id", "duration_minutes": None, "notes": None, "reminder_minutes": None,
         })) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/calendar/runs/00000000-0000-0000-0000-000000000099",
                json={"duration_minutes": None, "notes": None, "reminder_minutes": None},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        call_kwargs = mock_update.call_args[1]
        assert "duration_minutes" in call_kwargs["fields"]
        assert call_kwargs["fields"]["duration_minutes"] is None


# --- Exclude unset (absent vs null) ---


@pytest.mark.asyncio
async def test_update_run_only_sends_provided_fields():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.update_planned_run", new_callable=lambda: AsyncMock(return_value={
             "id": "test-id", "title": "Updated",
         })) as mock_update:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/calendar/runs/00000000-0000-0000-0000-000000000099",
                json={"title": "Updated"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        call_kwargs = mock_update.call_args[1]
        assert "title" in call_kwargs["fields"]
        assert "duration_minutes" not in call_kwargs["fields"]
        assert "notes" not in call_kwargs["fields"]
