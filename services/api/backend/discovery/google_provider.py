"""Normalize minimal Google listings, without inferring equipment or availability."""

import re

from backend.discovery.countries import region_code
from backend.discovery.enrichment import configured_enrichment_limit, derive_public_evidence
from backend.discovery.geo import (
    MIN_RELEVANT_CANDIDATES, SEARCH_RADII_KM, coordinates, location_country, ranking_key, straight_line_km,
)
from backend.discovery.models import GOOGLE_SOURCE, PublicPartnerData
from backend.discovery.places_client import GooglePlacesClient
from backend.discovery.profile_builder import build_profile, normalize_term
from backend.discovery.query_builder import MAX_QUERIES, build_queries
from backend.discovery.scorer import score_profile
from backend.discovery.signals import normalize_text


MAX_CANDIDATES = 10
MAX_GEO_SEARCHES = MAX_QUERIES * len(SEARCH_RADII_KM)
NAME_MATERIALS = {"wood", "plywood", "acrylic", "pla", "abs", "aluminum", "aluminium", "steel"}


def text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def normalize_place(place: dict) -> PublicPartnerData | None:
    place_id = text(place.get("id"))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,512}", place_id):
        return None
    display = place.get("displayName")
    name = text(display.get("text")) if isinstance(display, dict) else ""
    city = country = ""
    components = place.get("addressComponents")
    if isinstance(components, list):
        for kind in ("postal_town", "locality"):
            for component in components:
                if not isinstance(component, dict) or not isinstance(component.get("types"), list):
                    continue
                if kind in component["types"]:
                    city = text(component.get("longText")) or city
                if "country" in component["types"]:
                    country = text(component.get("shortText")) or text(component.get("longText")) or country
    types = place.get("types")
    types = [text(item) for item in types if text(item)] if isinstance(types, list) else []
    primary_type = text(place.get("primaryType"))
    if primary_type:
        types.append(primary_type)
    point = coordinates(place.get("location"))
    words = set(re.findall(r"[a-z0-9]+", name.casefold()))
    return PublicPartnerData(
        source_place_id=place_id, display_name=name or "Unnamed Google Places listing",
        city=city, country=country, source=GOOGLE_SOURCE,
        materials=tuple(sorted(words & NAME_MATERIALS)), specializations=tuple(sorted(set(types))),
        latitude=point[0] if point is not None else None, longitude=point[1] if point is not None else None,
    )


def matches_country(place: dict, requested_country: str) -> bool:
    requested = normalize_term(normalize_text(requested_country))
    if not requested_country.strip():
        return True
    if not requested:
        return False
    components = place.get("addressComponents")
    if not isinstance(components, list):
        return False
    countries = [component for component in components if isinstance(component, dict)
                 and isinstance(component.get("types"), list) and "country" in component["types"]]
    if not countries:
        return False
    for component in countries:
        short = text(component.get("shortText"))
        long = text(component.get("longText"))
        actual = normalize_term(normalize_text(short or long))
        if requested != actual:
            # Codes (including the existing Serbia -> RS alias) trust the returned short code.
            if len(requested) == 2 or requested != normalize_term(normalize_text(long)):
                return False
    return True


class GooglePlacesDiscoveryProvider:
    source = GOOGLE_SOURCE

    def __init__(self, client: GooglePlacesClient | None = None):
        self.client = client if client is not None else GooglePlacesClient()
        self.enrich_top_n = configured_enrichment_limit()

    def enrich(self, place_id: str) -> dict:
        return derive_public_evidence(self.client.place_details(place_id))

    def discover(self, specification: dict) -> list[PublicPartnerData]:
        partners = {}
        location = specification.get("location") or {}
        country = location_country(location)
        origin = coordinates(location)
        queries = build_queries(specification, limit=MAX_GEO_SEARCHES if origin is not None else MAX_QUERIES)
        if not queries:
            return []
        profiles = {}
        radii = SEARCH_RADII_KM if origin is not None else (None,)
        for stage, radius in enumerate(radii):
            stage_queries = [queries[(stage * MAX_QUERIES + index) % len(queries)]
                             for index in range(min(MAX_QUERIES, len(queries)))]
            for query in stage_queries:
                options = {"region_code": region_code(country)}
                if origin is not None:
                    options.update({"center": origin, "radius_km": radius})
                for place in self.client.text_search(query, **options):
                    partner = normalize_place(place)
                    if partner is None or not matches_country(place, country):
                        continue
                    if location.get("country") and not matches_country(place, location["country"]):
                        continue
                    if partner.source_place_id in partners:
                        continue
                    point = coordinates({"latitude": partner.latitude, "longitude": partner.longitude})
                    distance = straight_line_km(origin, point) if origin is not None and point is not None else None
                    if distance is not None and distance > radius + 1e-6:
                        continue
                    partners[partner.source_place_id] = partner
                    if origin is not None:
                        profile = build_profile(partner)
                        if distance is not None:
                            profile["distance_km"] = round(distance, 3)
                        score = score_profile(specification, profile)
                        profile.update({"fit_score": score.fit_score, "score_breakdown": score.score_breakdown})
                        profiles[partner.source_place_id] = profile
                    elif len(partners) == MAX_CANDIDATES:
                        return list(partners.values())
            # Unknown distance and unrelated businesses never stop geographic expansion.
            relevant = sum(profile["score_breakdown"]["process_match"] > 0 and profile.get("distance_km") is not None
                           for profile in profiles.values())
            if origin is not None and relevant >= MIN_RELEVANT_CANDIDATES:
                break
        if origin is not None:
            ids = sorted(partners, key=lambda place_id: ranking_key(profiles[place_id], place_id, geo=True))
            return [partners[place_id] for place_id in ids[:MAX_CANDIDATES]]
        return list(partners.values())
