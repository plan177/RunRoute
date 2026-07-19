import json
import logging
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from uuid import uuid4

from backend.routes import _normalize_points, create_saved_route, get_saved_route


# --- _normalize_points unit tests ---

class TestNormalizePoints:
    def test_list_passthrough(self):
        pts = [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}]
        assert _normalize_points(pts) is pts

    def test_json_string_to_list(self):
        pts = [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}]
        result = _normalize_points(json.dumps(pts))
        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]["lat"] == 55.7

    def test_json_string_with_nested_objects(self):
        pts = [{"lat": 55.7, "lng": 37.6, "time": "2026-01-01T10:00:00Z", "accuracy": 5.0}]
        result = _normalize_points(json.dumps(pts))
        assert result[0]["time"] == "2026-01-01T10:00:00Z"
        assert result[0]["accuracy"] == 5.0

    def test_empty_json_array(self):
        assert _normalize_points("[]") == []

    def test_malformed_json_raises(self):
        with pytest.raises(ValueError, match="points must be a JSON array"):
            _normalize_points("not json {{{")

    def test_json_non_array_raises(self):
        with pytest.raises(ValueError, match="points must be a JSON array"):
            _normalize_points('{"not": "array"}')

    def test_json_number_raises(self):
        with pytest.raises(ValueError, match="points must be a JSON array"):
            _normalize_points("42")

    def test_none_raises(self):
        with pytest.raises(ValueError, match="points must be a list or JSON string"):
            _normalize_points(None)

    def test_dict_raises(self):
        with pytest.raises(ValueError, match="points must be a list or JSON string"):
            _normalize_points({"lat": 55.7})

    def test_invalid_json_syntax(self):
        with pytest.raises(ValueError, match="points must be a JSON array"):
            _normalize_points("[{invalid]")


# --- asyncpg Record-like mock ---

class FakeRecord:
    def __init__(self, data: dict):
        self._data = data

    def keys(self):
        return self._data.keys()

    def __getitem__(self, key):
        return self._data[key]


def _make_row(points_value):
    return FakeRecord({
        "id": uuid4(),
        "name": "Test Route",
        "route_mode": "auto",
        "distance_m": 5000,
        "points": points_value,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    })


SAMPLE_POINTS = [{"lat": 55.7, "lng": 37.6}, {"lat": 55.8, "lng": 37.7}]


def _make_mock_conn(row):
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=row)
    return mock_conn


def _make_mock_pool(conn):
    mock_pool = MagicMock()
    mock_acm = MagicMock()
    mock_acm.__aenter__ = AsyncMock(return_value=conn)
    mock_acm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_acm)
    return mock_pool


# --- create_saved_route integration ---

@pytest.mark.asyncio
async def test_create_saved_route_returns_points_as_list_from_string():
    row = _make_row(json.dumps(SAMPLE_POINTS))
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        result = await create_saved_route(
            user_id=uuid4(), name="Test Route", route_mode="auto",
            distance_m=5000, points=SAMPLE_POINTS,
        )

    assert isinstance(result["points"], list)
    assert len(result["points"]) == 2
    assert result["points"][0]["lat"] == 55.7


@pytest.mark.asyncio
async def test_create_saved_route_returns_points_as_list_from_list():
    row = _make_row(SAMPLE_POINTS)
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        result = await create_saved_route(
            user_id=uuid4(), name="Test Route", route_mode="auto",
            distance_m=5000, points=SAMPLE_POINTS,
        )

    assert isinstance(result["points"], list)
    assert len(result["points"]) == 2


@pytest.mark.asyncio
async def test_create_saved_route_malformed_json_raises():
    row = _make_row("not valid json")
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        with pytest.raises(ValueError, match="points must be a JSON array"):
            await create_saved_route(
                user_id=uuid4(), name="Test", route_mode="auto",
                distance_m=5000, points=SAMPLE_POINTS,
            )


# --- get_saved_route integration ---

@pytest.mark.asyncio
async def test_get_saved_route_returns_points_as_list_from_string():
    row = _make_row(json.dumps(SAMPLE_POINTS))
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        result = await get_saved_route(user_id=uuid4(), route_id=uuid4())

    assert isinstance(result["points"], list)
    assert len(result["points"]) == 2
    assert result["points"][0]["lat"] == 55.7


@pytest.mark.asyncio
async def test_get_saved_route_returns_points_as_list_from_list():
    row = _make_row(SAMPLE_POINTS)
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        result = await get_saved_route(user_id=uuid4(), route_id=uuid4())

    assert isinstance(result["points"], list)


@pytest.mark.asyncio
async def test_get_saved_route_returns_none_when_not_found():
    conn = _make_mock_conn(row=None)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        result = await get_saved_route(user_id=uuid4(), route_id=uuid4())

    assert result is None


@pytest.mark.asyncio
async def test_get_saved_route_enforces_user_ownership():
    user_id = uuid4()
    route_id = uuid4()
    row = _make_row(json.dumps(SAMPLE_POINTS))
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        await get_saved_route(user_id=user_id, route_id=route_id)

    call_args = conn.fetchrow.call_args
    sql = call_args[0][0]
    assert "user_id = $2" in sql


# --- Error logging: points content must not appear in logs ---

@pytest.mark.asyncio
async def test_create_saved_route_does_not_log_points_content(caplog):
    row = _make_row(SAMPLE_POINTS)
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        with caplog.at_level(logging.ERROR):
            try:
                await create_saved_route(
                    user_id=uuid4(), name="Test", route_mode="auto",
                    distance_m=5000, points=SAMPLE_POINTS,
                )
            except Exception:
                pass

    for record in caplog.records:
        assert "55.7" not in record.getMessage()
        assert "37.6" not in record.getMessage()


@pytest.mark.asyncio
async def test_get_saved_route_does_not_log_points_content(caplog):
    row = _make_row(SAMPLE_POINTS)
    conn = _make_mock_conn(row)
    pool = _make_mock_pool(conn)

    with patch("backend.routes.get_db_pool", return_value=pool):
        with caplog.at_level(logging.ERROR):
            try:
                await get_saved_route(user_id=uuid4(), route_id=uuid4())
            except Exception:
                pass

    for record in caplog.records:
        assert "55.7" not in record.getMessage()
        assert "37.6" not in record.getMessage()


# --- Endpoint contract tests ---

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
        "photo_url": "https://example.com/photo.jpg",
    }
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


def _mock_user():
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "telegram_user_id": 123456,
        "telegram_username": "testuser",
        "first_name": "Test",
        "last_name": "User",
        "language_code": "ru",
        "telegram_photo_url": "https://example.com/photo.jpg",
    }


def _clear_rate_limit():
    from backend.main import RATE_LIMIT_STORE
    RATE_LIMIT_STORE.clear()


@pytest.mark.asyncio
async def test_get_route_endpoint_returns_points_as_array():
    from httpx import AsyncClient, ASGITransport
    from backend.main import app

    route = {
        "id": str(uuid4()),
        "name": "Test",
        "route_mode": "auto",
        "distance_m": 5000,
        "points": SAMPLE_POINTS,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.get_saved_route", new_callable=AsyncMock, return_value=route):

        _clear_rate_limit()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                f"/api/routes/{route['id']}",
                headers={"X-Telegram-Init-Data": _make_init_data()},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["points"], list)
    assert len(body["points"]) == 2
    assert body["points"][0]["lat"] == 55.7


@pytest.mark.asyncio
async def test_create_route_endpoint_returns_points_as_array():
    from httpx import AsyncClient, ASGITransport
    from backend.main import app

    route = {
        "id": str(uuid4()),
        "name": "Test",
        "route_mode": "auto",
        "distance_m": 5000,
        "points": SAMPLE_POINTS,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.create_saved_route", new_callable=AsyncMock, return_value=route):

        _clear_rate_limit()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/api/routes",
                json={
                    "name": "Test Route",
                    "route_mode": "auto",
                    "distance_m": 5000,
                    "points": SAMPLE_POINTS,
                },
                headers={"X-Telegram-Init-Data": _make_init_data()},
            )

    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["points"], list)
    assert len(body["points"]) == 2
    assert body["points"][0]["lat"] == 55.7


@pytest.mark.asyncio
async def test_get_route_returns_404_for_other_user():
    from httpx import AsyncClient, ASGITransport
    from backend.main import app

    with patch("backend.auth.get_settings", return_value=_mock_auth_settings()), \
         patch("backend.main.upsert_user", new_callable=AsyncMock, return_value=_mock_user()), \
         patch("backend.main.get_saved_route", new_callable=AsyncMock, return_value=None):

        _clear_rate_limit()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get(
                f"/api/routes/{uuid4()}",
                headers={"X-Telegram-Init-Data": _make_init_data()},
            )

    assert resp.status_code == 404
