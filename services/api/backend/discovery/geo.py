"""Bounded spherical geometry and relevance-first ranking; never driving distance."""

import math


EARTH_RADIUS_KM = 6371.0088
SEARCH_RADII_KM = (25, 50, 100)
MIN_RELEVANT_CANDIDATES = 5
RELEVANCE_CATEGORIES = ("process_match", "material_signal", "equipment_signal", "business_specialization")


def coordinates(location: dict | None) -> tuple[float, float] | None:
    if not isinstance(location, dict):
        return None
    latitude, longitude = location.get("latitude"), location.get("longitude")
    if any(isinstance(value, bool) or not isinstance(value, (float, int))
           for value in (latitude, longitude)):
        return None
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return None
    return float(latitude), float(longitude)


def location_country(location: dict | None) -> str:
    location = location or {}
    return location.get("country_code") or location.get("country") or ""


def straight_line_km(origin: tuple[float, float], destination: tuple[float, float]) -> float:
    first_lat, first_lon = map(math.radians, origin)
    second_lat, second_lon = map(math.radians, destination)
    value = math.sin((second_lat - first_lat) / 2) ** 2 + (
        math.cos(first_lat) * math.cos(second_lat) * math.sin((second_lon - first_lon) / 2) ** 2)
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(max(0., min(1., value))))


def search_rectangle(center: tuple[float, float], radius_km: int) -> dict:
    if coordinates(dict(zip(("latitude", "longitude"), center))) is None or radius_km not in SEARCH_RADII_KM:
        raise ValueError("Unsupported discovery search area")
    latitude, longitude = map(math.radians, center)
    angular = radius_km / EARTH_RADIUS_KM
    low_lat, high_lat = max(-math.pi / 2, latitude - angular), min(math.pi / 2, latitude + angular)
    if low_lat == -math.pi / 2 or high_lat == math.pi / 2:
        low_lon, high_lon = -180., 180.
    else:
        delta = math.asin(min(1., math.sin(angular) / math.cos(latitude)))
        low_lon = (math.degrees(longitude - delta) + 180) % 360 - 180
        high_lon = (math.degrees(longitude + delta) + 180) % 360 - 180
    return {"low": {"latitude": math.degrees(low_lat), "longitude": low_lon},
            "high": {"latitude": math.degrees(high_lat), "longitude": high_lon}}


def ranking_key(profile: dict, place_id: str, *, geo: bool) -> tuple:
    if not geo:
        return -profile["fit_score"], place_id
    relevance = sum(profile["score_breakdown"].get(key, 0) for key in RELEVANCE_CATEGORIES)
    distance = profile.get("distance_km")
    return -relevance, distance if distance is not None else math.inf, -profile["fit_score"], place_id
