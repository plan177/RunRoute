import pytest
from unittest.mock import patch, MagicMock, AsyncMock


def test_health_response_model():
    from backend.models import HealthResponse
    response = HealthResponse(
        status="healthy",
        database="connected",
        timestamp="2024-01-01T00:00:00"
    )
    assert response.status == "healthy"
    assert response.database == "connected"
    assert response.timestamp == "2024-01-01T00:00:00"


def test_user_model_fields():
    from backend.models import UserModel
    assert UserModel.__tablename__ == "users"


def test_profile_model_fields():
    from backend.models import ProfileModel
    assert ProfileModel.__tablename__ == "profiles"
