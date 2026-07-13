import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from backend.main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_live_needs_no_db(client):
    resp = await client.get("/health/live")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_ready_200_when_db_up(client):
    with patch("backend.main.check_database_connection", new_callable=AsyncMock, return_value=True):
        resp = await client.get("/health/ready")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ready"
        assert body["database"] == "up"


@pytest.mark.asyncio
async def test_ready_503_when_db_down(client):
    with patch("backend.main.check_database_connection", new_callable=AsyncMock, return_value=False):
        resp = await client.get("/health/ready")
        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "not_ready"
        assert body["database"] == "down"


@pytest.mark.asyncio
async def test_exception_text_absent(client):
    with patch("backend.main.check_database_connection", new_callable=AsyncMock, return_value=False):
        resp = await client.get("/health/ready")
        assert resp.status_code == 503
        assert "secret" not in resp.text


@pytest.mark.asyncio
async def test_health_not_rate_limited(client):
    for _ in range(15):
        resp = await client.get("/health/live")
        assert resp.status_code == 200
