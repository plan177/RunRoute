from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Text, Float, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


# SQLAlchemy Models

class UserModel(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True)
    username = Column(String(255), nullable=True)
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    language_code = Column(String(10), nullable=True)
    is_premium = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    profile = relationship("ProfileModel", back_populates="user", uselist=False)


class ProfileModel(Base):
    __tablename__ = "profiles"

    id = Column(String(36), primary_key=True)  # UUID
    user_id = Column(BigInteger, ForeignKey("users.id"), unique=True)
    display_name = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)
    preferred_distance_km = Column(Float, default=5.0)
    preferred_pace_sec_per_km = Column(Float, nullable=True)
    units = Column(String(10), default="metric")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserModel", back_populates="profile")


# Pydantic Models

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


class UserProfile(BaseModel):
    user_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    display_name: Optional[str] = None
    bio: Optional[str] = None
    preferred_distance_km: float = 5.0
    preferred_pace_sec_per_km: Optional[float] = None
    units: str = "metric"


class HealthResponse(BaseModel):
    status: str
    database: str
    timestamp: str
