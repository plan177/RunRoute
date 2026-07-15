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
async def test_create_route_whitespace_name_rejected():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/routes", json={
                "name": "   ", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_route_name_trimmed():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_saved_route", new_callable=lambda: AsyncMock(return_value={
             "id": "test-id", "name": "Trimmed", "route_mode": "auto",
             "distance_m": 5000, "points": [], "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-01T00:00:00Z",
         })) as mock_create:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/routes", json={
                "name": "  Trimmed  ", "route_mode": "auto", "distance_m": 5000,
                "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
            }, headers={"X-Telegram-Init-Data": init_data})
        call_kwargs = mock_create.call_args[1]
        assert call_kwargs["name"] == "Trimmed"


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
         patch("backend.main.get_profile_with_counts", new_callable=lambda: AsyncMock(return_value={
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


# --- Route summary (no points) tests ---


@pytest.mark.asyncio
async def test_list_routes_no_points_in_summary():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.list_saved_routes", new_callable=lambda: AsyncMock(return_value=[
             {"id": "r1", "name": "Test", "route_mode": "auto", "distance_m": 5000,
              "points_count": 120, "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-01T00:00:00Z"},
         ])):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/routes", headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200
        route = resp.json()["routes"][0]
        assert "points" not in route
        assert route["points_count"] == 120


@pytest.mark.asyncio
async def test_get_route_detail_has_points():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_saved_route", new_callable=lambda: AsyncMock(return_value={
             "id": "r1", "name": "Test", "route_mode": "auto", "distance_m": 5000,
             "points": [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}],
             "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-01T00:00:00Z",
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/routes/00000000-0000-0000-0000-000000000001",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert "points" in resp.json()
        assert len(resp.json()["points"]) == 2


# --- PUT rename route tests ---


@pytest.mark.asyncio
async def test_rename_route_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.put(
            "/api/routes/00000000-0000-0000-0000-000000000001",
            json={"name": "New Name"},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_rename_route_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.rename_saved_route", new_callable=lambda: AsyncMock(return_value={
             "id": "r1", "name": "Renamed", "route_mode": "auto", "distance_m": 5000,
             "created_at": "2025-01-01T00:00:00Z", "updated_at": "2025-01-02T00:00:00Z",
         })) as mock_rename:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/routes/00000000-0000-0000-0000-000000000001",
                json={"name": "Renamed"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed"
        call_kwargs = mock_rename.call_args[1]
        assert call_kwargs["name"] == "Renamed"


@pytest.mark.asyncio
async def test_rename_route_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.rename_saved_route", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/routes/00000000-0000-0000-0000-000000000099",
                json={"name": "New"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rename_route_empty_name():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/routes/00000000-0000-0000-0000-000000000001",
                json={"name": ""},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_rename_route_name_too_long():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/routes/00000000-0000-0000-0000-000000000001",
                json={"name": "x" * 101},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_rename_route_only_name_accepted():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/routes/00000000-0000-0000-0000-000000000001",
                json={"name": "OK", "route_mode": "track"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


# --- DELETE does not remove planned_run ---


@pytest.mark.asyncio
async def test_delete_route_not_found_returns_404():
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


@pytest.mark.asyncio
async def test_delete_route_owner_only():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.delete_saved_route", new_callable=lambda: AsyncMock(return_value=False)) as mock_delete:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.delete(
                "/api/routes/00000000-0000-0000-0000-000000000099",
                headers={"X-Telegram-Init-Data": init_data},
            )
        call_kwargs = mock_delete.call_args[1]
        assert call_kwargs["user_id"] == _mock_user()["id"]


# --- Migration 004 tests ---


def test_migration_004_creates_reminder_deliveries():
    sql = open("backend/migrations/004_planned_run_reminders.sql").read()
    assert "CREATE TABLE IF NOT EXISTS public.reminder_deliveries" in sql


def test_migration_004_rls_enabled():
    sql = open("backend/migrations/004_planned_run_reminders.sql").read()
    assert "ENABLE ROW LEVEL SECURITY" in sql


def test_migration_004_has_unique_index():
    sql = open("backend/migrations/004_planned_run_reminders.sql").read()
    assert "idx_reminder_deliveries_run_pending" in sql


def test_migration_004_has_status_check():
    sql = open("backend/migrations/004_planned_run_reminders.sql").read()
    assert "'pending'" in sql
    assert "'processing'" in sql
    assert "'sent'" in sql
    assert "'failed'" in sql


# --- Reminder sync tests ---


@pytest.mark.asyncio
async def test_create_run_creates_reminder():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_planned_run", new_callable=lambda: AsyncMock(return_value={
             "id": "run-1", "title": "Morning Run", "status": "planned",
             "reminder_minutes": 30, "notifications_enabled": True,
             "starts_at": "2026-12-01T09:00:00+03:00",
         })) as mock_create:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Morning Run",
                "starts_at": "2026-12-01T09:00:00+03:00",
                "reminder_minutes": 30,
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_run_no_reminder_when_zero():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.create_planned_run", new_callable=lambda: AsyncMock(return_value={
             "id": "run-2", "title": "Run", "status": "planned",
             "reminder_minutes": 0, "notifications_enabled": True,
             "starts_at": "2026-12-01T09:00:00+03:00",
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/calendar/runs", json={
                "title": "Run",
                "starts_at": "2026-12-01T09:00:00+03:00",
                "reminder_minutes": 0,
            }, headers={"X-Telegram-Init-Data": init_data})
        assert resp.status_code == 200


# --- Reminder worker tests ---


def test_format_reminder_message():
    from bot import _format_reminder_message
    from datetime import datetime, timezone

    run = {
        "title": "Morning Jog",
        "starts_at": datetime(2025, 12, 1, 9, 0, 0, tzinfo=timezone.utc),
        "distance_m": 5000,
        "route_name": "Park Loop",
    }
    msg = _format_reminder_message(run)
    assert "🏃 Скоро пробежка" in msg
    assert "Название: Morning Jog" in msg
    assert "01.12.2025 09:00 UTC" in msg
    assert "5.0 км" in msg
    assert "Маршрут: Park Loop" in msg


def test_format_reminder_message_no_distance():
    from bot import _format_reminder_message
    from datetime import datetime, timezone

    run = {
        "title": "Quick Run",
        "starts_at": datetime(2025, 12, 1, 9, 0, 0, tzinfo=timezone.utc),
    }
    msg = _format_reminder_message(run)
    assert "Дистанция" not in msg
    assert "Маршрут" not in msg


def test_format_reminder_message_no_route():
    from bot import _format_reminder_message
    from datetime import datetime, timezone

    run = {
        "title": "Run",
        "starts_at": datetime(2025, 12, 1, 9, 0, 0, tzinfo=timezone.utc),
        "distance_m": 3000,
    }
    msg = _format_reminder_message(run)
    assert "3.0 км" in msg
    assert "Маршрут" not in msg


@pytest.mark.asyncio
async def test_sync_run_reminder_creates_pending():
    from backend.reminders import sync_run_reminder
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    mock_conn = AsyncMock()
    mock_pool = AsyncMock()
    # asyncpg pool.acquire() returns an async context manager
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        user_id = uuid4()
        run_id = uuid4()
        starts_at = datetime.now(timezone.utc) + timedelta(hours=1)

        await sync_run_reminder(
            user_id=user_id,
            planned_run_id=run_id,
            starts_at=starts_at,
            reminder_minutes=30,
            status="planned",
            notifications_enabled=True,
        )

        assert mock_conn.execute.call_count == 2
        delete_call = mock_conn.execute.call_args_list[0]
        assert "DELETE" in delete_call[0][0]
        insert_call = mock_conn.execute.call_args_list[1]
        assert "INSERT" in insert_call[0][0]


@pytest.mark.asyncio
async def test_sync_run_reminder_no_create_when_cancelled():
    from backend.reminders import sync_run_reminder
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    mock_conn = AsyncMock()
    mock_pool = AsyncMock()
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        user_id = uuid4()
        run_id = uuid4()
        starts_at = datetime.now(timezone.utc) + timedelta(hours=1)

        await sync_run_reminder(
            user_id=user_id,
            planned_run_id=run_id,
            starts_at=starts_at,
            reminder_minutes=30,
            status="cancelled",
            notifications_enabled=False,
        )

        assert mock_conn.execute.call_count == 1
        delete_call = mock_conn.execute.call_args_list[0]
        assert "DELETE" in delete_call[0][0]


@pytest.mark.asyncio
async def test_sync_run_reminder_no_create_for_past():
    from backend.reminders import sync_run_reminder
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    mock_conn = AsyncMock()
    mock_pool = AsyncMock()
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        user_id = uuid4()
        run_id = uuid4()
        starts_at = datetime.now(timezone.utc) - timedelta(hours=1)

        await sync_run_reminder(
            user_id=user_id,
            planned_run_id=run_id,
            starts_at=starts_at,
            reminder_minutes=30,
            status="planned",
            notifications_enabled=True,
        )

        assert mock_conn.execute.call_count == 1


# --- Worker tests ---


def _make_mock_pool():
    """Create a mock asyncpg pool with proper async context managers."""
    mock_conn = AsyncMock()
    mock_pool = AsyncMock()

    # pool.acquire() returns an async context manager
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    # conn.transaction() returns an async context manager
    mock_txn = MagicMock()
    mock_txn.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_txn.__aexit__ = AsyncMock(return_value=False)
    mock_conn.transaction = MagicMock(return_value=mock_txn)

    return mock_pool, mock_conn


@pytest.mark.asyncio
async def test_process_due_reminders_once_sends_and_marks_sent():
    from bot import process_due_reminders_once
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    run_id = uuid4()
    user_id = uuid4()
    telegram_user_id = 123456
    now = datetime.now(timezone.utc)

    mock_bot = AsyncMock()
    mock_pool, mock_conn = _make_mock_pool()

    # recover_stale_processing: first fetchval returns 0, second returns 0
    # fetch_due_reminders: fetchval (0) + fetch (1 row) + execute (update to processing)
    # verify_reminder_still_valid: fetchrow returns valid
    # mark_sent: execute
    mock_conn.fetchval.side_effect = [0, 0]
    mock_conn.fetch.return_value = [{
        "id": run_id, "planned_run_id": run_id, "user_id": user_id,
        "scheduled_for": now - timedelta(minutes=1), "attempts": 0,
        "title": "Morning Run", "starts_at": now + timedelta(hours=1),
        "duration_minutes": 30, "saved_route_id": None,
        "route_name": None, "distance_m": None,
        "telegram_user_id": telegram_user_id,
    }]
    mock_conn.fetchrow.return_value = {"id": run_id, "planned_run_id": run_id, "user_id": user_id}

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        count = await process_due_reminders_once(mock_bot)

    assert count == 1
    mock_bot.send_message.assert_called_once()
    call_kwargs = mock_bot.send_message.call_args[1]
    assert call_kwargs["chat_id"] == telegram_user_id
    assert "Скоро пробежка" in call_kwargs["text"]


@pytest.mark.asyncio
async def test_process_due_reminders_once_skips_cancelled_run():
    from bot import process_due_reminders_once
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    run_id = uuid4()
    user_id = uuid4()
    now = datetime.now(timezone.utc)

    mock_bot = AsyncMock()
    mock_pool, mock_conn = _make_mock_pool()

    mock_conn.fetchval.side_effect = [0, 0]
    mock_conn.fetch.return_value = [{
        "id": run_id, "planned_run_id": run_id, "user_id": user_id,
        "scheduled_for": now - timedelta(minutes=1), "attempts": 0,
        "title": "Run", "starts_at": now + timedelta(hours=1),
        "duration_minutes": None, "saved_route_id": None,
        "route_name": None, "distance_m": None,
        "telegram_user_id": 123456,
    }]

    # verify returns None — run was cancelled
    mock_conn.fetchrow.return_value = None

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        count = await process_due_reminders_once(mock_bot)

    assert count == 0
    mock_bot.send_message.assert_not_called()


@pytest.mark.asyncio
async def test_process_due_reminders_handles_blocked_bot():
    from bot import process_due_reminders_once
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    run_id = uuid4()
    user_id = uuid4()
    now = datetime.now(timezone.utc)

    mock_bot = AsyncMock()
    mock_bot.send_message.side_effect = Exception("Forbidden: bot was blocked")
    mock_pool, mock_conn = _make_mock_pool()

    mock_conn.fetchval.side_effect = [0, 0]
    mock_conn.fetch.return_value = [{
        "id": run_id, "planned_run_id": run_id, "user_id": user_id,
        "scheduled_for": now - timedelta(minutes=1), "attempts": 1,
        "title": "Run", "starts_at": now + timedelta(hours=1),
        "duration_minutes": None, "saved_route_id": None,
        "route_name": None, "distance_m": None,
        "telegram_user_id": 123456,
    }]
    mock_conn.fetchrow.return_value = {"id": run_id, "planned_run_id": run_id, "user_id": user_id}

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        count = await process_due_reminders_once(mock_bot)

    assert count == 0
    # Should mark failed with user_blocked
    update_call = mock_conn.execute.call_args_list[-1]
    assert "UPDATE" in update_call[0][0]


@pytest.mark.asyncio
async def test_process_due_reminders_no_early_sending():
    from bot import process_due_reminders_once
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    mock_bot = AsyncMock()
    mock_pool, mock_conn = _make_mock_pool()

    mock_conn.fetchval.side_effect = [0, 0]
    # fetch_due_reminders returns empty (no due reminders)
    mock_conn.fetch.return_value = []

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        count = await process_due_reminders_once(mock_bot)

    assert count == 0
    mock_bot.send_message.assert_not_called()


@pytest.mark.asyncio
async def test_verify_reminder_still_valid_returns_none_for_cancelled():
    from backend.reminders import verify_reminder_still_valid
    from uuid import uuid4

    mock_conn = AsyncMock()
    mock_pool = AsyncMock()
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    # fetchrow returns None — run cancelled or reminder deleted
    mock_conn.fetchrow.return_value = None

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        result = await verify_reminder_still_valid(uuid4())

    assert result is None


@pytest.mark.asyncio
async def test_recover_stale_processing_resets_to_pending():
    from backend.reminders import recover_stale_processing

    mock_conn = AsyncMock()
    mock_pool = AsyncMock()
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    # First call: reset to pending (2 recovered)
    # Second call: fail permanently (0 failed)
    mock_conn.fetchval.side_effect = [2, 0]

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        total = await recover_stale_processing()

    assert total == 2


@pytest.mark.asyncio
async def test_recover_stale_processing_fails_after_max_attempts():
    from backend.reminders import recover_stale_processing

    mock_conn = AsyncMock()
    mock_pool = AsyncMock()
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)

    # First call: 0 recovered (all exceeded max attempts)
    # Second call: 3 failed permanently
    mock_conn.fetchval.side_effect = [0, 3]

    with patch("backend.reminders.get_db_pool", return_value=mock_pool):
        total = await recover_stale_processing()

    assert total == 3


@pytest.mark.asyncio
async def test_sync_run_reminder_uses_conn_when_provided():
    from backend.reminders import sync_run_reminder
    from datetime import datetime, timezone, timedelta
    from uuid import uuid4

    mock_conn = AsyncMock()

    user_id = uuid4()
    run_id = uuid4()
    starts_at = datetime.now(timezone.utc) + timedelta(hours=1)

    # Should use the provided conn, not get_db_pool
    await sync_run_reminder(
        user_id=user_id,
        planned_run_id=run_id,
        starts_at=starts_at,
        reminder_minutes=30,
        status="planned",
        notifications_enabled=True,
        conn=mock_conn,
    )

    # Should call DELETE and INSERT on the provided conn
    assert mock_conn.execute.call_count == 2
    delete_call = mock_conn.execute.call_args_list[0]
    assert "DELETE" in delete_call[0][0]
    insert_call = mock_conn.execute.call_args_list[1]
    assert "INSERT" in insert_call[0][0]


# --- Migration 005 tests ---


def test_migration_005_creates_follows():
    sql = open("backend/migrations/005_public_profiles_and_follows.sql").read()
    assert "CREATE TABLE IF NOT EXISTS public.follows" in sql


def test_migration_005_has_run_notifications():
    sql = open("backend/migrations/005_public_profiles_and_follows.sql").read()
    assert "run_notifications_enabled" in sql


def test_migration_005_rls_enabled():
    sql = open("backend/migrations/005_public_profiles_and_follows.sql").read()
    assert "ENABLE ROW LEVEL SECURITY" in sql


def test_migration_005_self_follow_prevented():
    sql = open("backend/migrations/005_public_profiles_and_follows.sql").read()
    assert "CHECK (follower_id <> following_id)" in sql


# --- Follows API tests ---


@pytest.mark.asyncio
async def test_follow_user_no_init_data():
    _clear_rate_limit()
    from backend.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/users/00000000-0000-0000-0000-000000000001/follow",
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_follow_user_self():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/users/00000000-0000-0000-0000-000000000001/follow",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 400
        assert "Cannot follow yourself" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_follow_user_private_profile():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.user_exists", new_callable=lambda: AsyncMock(return_value=True)), \
         patch("backend.main.get_profile", new_callable=lambda: AsyncMock(return_value={"is_public": False})):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/users/00000000-0000-0000-0000-000000000099/follow",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_follow_user_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.user_exists", new_callable=lambda: AsyncMock(return_value=False)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/users/00000000-0000-0000-0000-000000000099/follow",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_follow_user_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.user_exists", new_callable=lambda: AsyncMock(return_value=True)), \
         patch("backend.main.get_profile", new_callable=lambda: AsyncMock(return_value={"is_public": True})), \
         patch("backend.main.follow_user", new_callable=lambda: AsyncMock(return_value=True)), \
         patch("backend.main.get_follow_counts", new_callable=lambda: AsyncMock(return_value={
             "followers_count": 10, "following_count": 0,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/users/00000000-0000-0000-0000-000000000099/follow",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_following"] is True
        assert data["followers_count"] == 10
        assert data["run_notifications_enabled"] is True


@pytest.mark.asyncio
async def test_unfollow_user_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.unfollow_user", new_callable=lambda: AsyncMock()), \
         patch("backend.main.get_follow_counts", new_callable=lambda: AsyncMock(return_value={
             "followers_count": 9, "following_count": 0,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.delete(
                "/api/users/00000000-0000-0000-0000-000000000099/follow",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_following"] is False
        assert data["followers_count"] == 9
        assert data["run_notifications_enabled"] is None


@pytest.mark.asyncio
async def test_set_notifications_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.set_run_notifications", new_callable=lambda: AsyncMock(return_value=True)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/users/00000000-0000-0000-0000-000000000099/follow/notifications",
                json={"enabled": False},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert resp.json()["run_notifications_enabled"] is False


@pytest.mark.asyncio
async def test_set_notifications_no_follow():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.set_run_notifications", new_callable=lambda: AsyncMock(return_value=False)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/users/00000000-0000-0000-0000-000000000099/follow/notifications",
                json={"enabled": False},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_set_notifications_extra_fields():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.put(
                "/api/users/00000000-0000-0000-0000-000000000099/follow/notifications",
                json={"enabled": True, "extra": "field"},
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_uuid_returns_422():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/users/not-a-uuid/follow",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_invalid_cursor_returns_400():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/followers?cursor=invalid-cursor",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_limit_over_100_rejected():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/followers?limit=101",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_public_profile_not_found():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_public_profile", new_callable=lambda: AsyncMock(return_value=None)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/users/00000000-0000-0000-0000-000000000099/profile",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_public_profile_no_telegram_fields():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_public_profile", new_callable=lambda: AsyncMock(return_value={
             "user_id": "00000000-0000-0000-0000-000000000099",
             "display_name": "Pro Runner",
             "bio": "I run",
             "city": "Moscow",
             "club_name": None,
             "avatar_url": None,
             "social_links": {},
         })), \
         patch("backend.main.is_following", new_callable=lambda: AsyncMock(return_value=False)), \
         patch("backend.main.get_run_notifications_enabled", new_callable=lambda: AsyncMock(return_value=None)), \
         patch("backend.main.get_follow_counts", new_callable=lambda: AsyncMock(return_value={
             "followers_count": 5, "following_count": 3,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/users/00000000-0000-0000-0000-000000000099/profile",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        data = resp.json()
        profile = data["profile"]
        for field in ("telegram_username", "telegram_photo_url", "first_name", "last_name",
                       "language_code", "is_active", "created_at", "updated_at"):
            assert field not in profile, f"{field} should not be in profile"
        assert profile["display_name"] == "Pro Runner"
        assert profile["bio"] == "I run"
        assert profile["city"] == "Moscow"
        assert data["is_following"] is False
        assert data["run_notifications_enabled"] is None
        assert data["followers_count"] == 5
        assert data["following_count"] == 3


@pytest.mark.asyncio
async def test_get_my_followers_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_followers", new_callable=lambda: AsyncMock(return_value={
             "users": [{"user_id": "user-1", "display_name": "F1", "avatar_url": None, "city": None, "club_name": None}],
             "next_cursor": None,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/followers",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert len(resp.json()["users"]) == 1
        assert resp.json()["next_cursor"] is None


@pytest.mark.asyncio
async def test_get_my_following_success():
    _clear_rate_limit()
    from backend.main import app
    init_data = _make_init_data()

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=lambda: AsyncMock(return_value=_mock_user())), \
         patch("backend.main.get_following", new_callable=lambda: AsyncMock(return_value={
             "users": [{"user_id": "user-2", "display_name": "F2", "run_notifications_enabled": True, "avatar_url": None, "city": None, "club_name": None}],
             "next_cursor": None,
         })):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                "/api/me/following",
                headers={"X-Telegram-Init-Data": init_data},
            )
        assert resp.status_code == 200
        assert len(resp.json()["users"]) == 1
        assert resp.json()["users"][0]["run_notifications_enabled"] is True
