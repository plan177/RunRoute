from pydantic import BaseModel
from typing import List, Optional

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
