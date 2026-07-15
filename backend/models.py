from datetime import datetime
from pydantic import BaseModel, field_validator
from typing import List, Optional
from uuid import UUID


ALLOWED_SOCIAL_KEYS = {"telegram", "instagram", "strava", "vk", "website"}
ALLOWED_URL_SCHEMES = {"http", "https"}
MAX_URL_LENGTH = 2048


def _validate_url(v: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(v)
    if parsed.scheme not in ALLOWED_URL_SCHEMES:
        raise ValueError("URL must use http or https scheme")
    if not parsed.hostname:
        raise ValueError("URL must have a hostname")
    if len(v) > MAX_URL_LENGTH:
        raise ValueError(f"URL must be {MAX_URL_LENGTH} characters or fewer")
    return v


class RouteRequest(BaseModel):
    lat: float
    lng: float
    distance_km: float = 5.0


class RoutePoint(BaseModel):
    lat: float
    lng: float
    elevation: Optional[float] = None


class RouteResponse(BaseModel):
    points: List[RoutePoint]
    distance_km: float
    duration_min: float
    gpx: str


class FeedbackRequest(BaseModel):
    message: str
    user_id: Optional[int] = None
    username: Optional[str] = None


class SocialLinks(BaseModel):
    telegram: Optional[str] = None
    instagram: Optional[str] = None
    strava: Optional[str] = None
    vk: Optional[str] = None
    website: Optional[str] = None

    @field_validator("*", mode="before")
    @classmethod
    def normalize_empty_to_none(cls, v):
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    @field_validator("*", mode="after")
    @classmethod
    def validate_urls(cls, v):
        if v is not None and isinstance(v, str):
            _validate_url(v)
        return v

    model_config = {"extra": "forbid"}


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    club_name: Optional[str] = None
    avatar_url: Optional[str] = None
    social_links: Optional[SocialLinks] = None
    is_public: Optional[bool] = None

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v):
        if v is not None and len(v) > 100:
            raise ValueError("display_name must be 100 characters or fewer")
        return v

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, v):
        if v is not None and len(v) > 1000:
            raise ValueError("bio must be 1000 characters or fewer")
        return v

    @field_validator("city")
    @classmethod
    def validate_city(cls, v):
        if v is not None and len(v) > 100:
            raise ValueError("city must be 100 characters or fewer")
        return v

    @field_validator("club_name")
    @classmethod
    def validate_club_name(cls, v):
        if v is not None and len(v) > 150:
            raise ValueError("club_name must be 150 characters or fewer")
        return v

    @field_validator("display_name", "bio", "city", "club_name", mode="before")
    @classmethod
    def normalize_empty_string(cls, v):
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    @field_validator("avatar_url", mode="before")
    @classmethod
    def normalize_avatar_url(cls, v):
        if isinstance(v, str) and v.strip() == "":
            return None
        if v is not None and isinstance(v, str):
            _validate_url(v)
        return v

    model_config = {"extra": "forbid"}


# --- Saved routes ---

MAX_ROUTE_POINTS = 10000
ALLOWED_ROUTE_MODES = {"auto", "manual", "track"}


class SavedRoutePoint(BaseModel):
    lat: float
    lng: float
    time: Optional[str] = None
    accuracy: Optional[float] = None

    @field_validator("lat")
    @classmethod
    def validate_lat(cls, v):
        if not (-90 <= v <= 90):
            raise ValueError("lat must be between -90 and 90")
        return v

    @field_validator("lng")
    @classmethod
    def validate_lng(cls, v):
        if not (-180 <= v <= 180):
            raise ValueError("lng must be between -180 and 180")
        return v

    @field_validator("accuracy")
    @classmethod
    def validate_accuracy(cls, v):
        if v is not None and v < 0:
            raise ValueError("accuracy must be >= 0")
        return v

    @field_validator("time", mode="before")
    @classmethod
    def validate_time(cls, v):
        if v is not None and isinstance(v, str):
            try:
                datetime.fromisoformat(v)
            except ValueError:
                raise ValueError("time must be a valid ISO datetime")
        return v

    model_config = {"extra": "forbid"}


class SavedRouteCreate(BaseModel):
    name: str
    route_mode: str
    distance_m: int
    points: List[SavedRoutePoint]

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not (1 <= len(v) <= 100):
            raise ValueError("name must be 1-100 characters")
        return v

    @field_validator("route_mode")
    @classmethod
    def validate_route_mode(cls, v):
        if v not in ALLOWED_ROUTE_MODES:
            raise ValueError(f"route_mode must be one of: {', '.join(sorted(ALLOWED_ROUTE_MODES))}")
        return v

    @field_validator("distance_m")
    @classmethod
    def validate_distance_m(cls, v):
        if v <= 0:
            raise ValueError("distance_m must be > 0")
        return v

    @field_validator("points")
    @classmethod
    def validate_points(cls, v):
        if len(v) < 2:
            raise ValueError("at least 2 points required")
        if len(v) > MAX_ROUTE_POINTS:
            raise ValueError(f"maximum {MAX_ROUTE_POINTS} points allowed")
        return v

    model_config = {"extra": "forbid"}


class SavedRouteRename(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not (1 <= len(v) <= 100):
            raise ValueError("name must be 1-100 characters")
        return v

    model_config = {"extra": "forbid"}


# --- Planned runs ---

ALLOWED_REMINDER_MINUTES = {0, 15, 30, 60, 180, 1440}
ALLOWED_RUN_STATUSES = {"planned", "cancelled", "completed"}


class PlannedRunCreate(BaseModel):
    saved_route_id: Optional[UUID] = None
    title: str
    starts_at: datetime
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    reminder_minutes: Optional[int] = None
    notifications_enabled: bool = True

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if not (1 <= len(v) <= 100):
            raise ValueError("title must be 1-100 characters")
        return v

    @field_validator("starts_at")
    @classmethod
    def validate_starts_at(cls, v):
        if v.tzinfo is None:
            raise ValueError("starts_at must be timezone-aware")
        if v < datetime.now(v.tzinfo):
            raise ValueError("starts_at must not be in the past")
        return v

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, v):
        if v is not None and not (1 <= v <= 1440):
            raise ValueError("duration_minutes must be 1-1440 or null")
        return v

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v):
        if v is not None and len(v) > 1000:
            raise ValueError("notes must be 1000 characters or fewer")
        return v

    @field_validator("reminder_minutes")
    @classmethod
    def validate_reminder(cls, v):
        if v is not None and v not in ALLOWED_REMINDER_MINUTES:
            raise ValueError(f"reminder_minutes must be one of: {sorted(ALLOWED_REMINDER_MINUTES)}")
        return v

    model_config = {"extra": "forbid"}


class PlannedRunUpdate(BaseModel):
    saved_route_id: Optional[UUID] = None
    title: Optional[str] = None
    starts_at: Optional[datetime] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    reminder_minutes: Optional[int] = None
    notifications_enabled: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if v is not None and not (1 <= len(v) <= 100):
            raise ValueError("title must be 1-100 characters")
        return v

    @field_validator("starts_at")
    @classmethod
    def validate_starts_at(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("starts_at must be timezone-aware")
        return v

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, v):
        if v is not None and not (1 <= v <= 1440):
            raise ValueError("duration_minutes must be 1-1440 or null")
        return v

    @field_validator("notes")
    @classmethod
    def validate_notes(cls, v):
        if v is not None and len(v) > 1000:
            raise ValueError("notes must be 1000 characters or fewer")
        return v

    @field_validator("reminder_minutes")
    @classmethod
    def validate_reminder(cls, v):
        if v is not None and v not in ALLOWED_REMINDER_MINUTES:
            raise ValueError(f"reminder_minutes must be one of: {sorted(ALLOWED_REMINDER_MINUTES)}")
        return v

    model_config = {"extra": "forbid"}


# --- Public profiles and follows ---


class FollowResponse(BaseModel):
    success: bool
    is_following: bool


class MuteResponse(BaseModel):
    success: bool
    is_muted: bool
