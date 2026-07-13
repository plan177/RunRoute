from pydantic import BaseModel, field_validator
from typing import List, Optional


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
