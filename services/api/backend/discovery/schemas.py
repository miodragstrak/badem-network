"""Public manufacturing-request and potential-partner API contracts."""

from __future__ import annotations

import json
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from backend.discovery.countries import region_code
from backend.discovery.geo import coordinates

RequestStatus = Literal["DRAFT", "SPECIFIED", "DISCOVERY_READY", "DISCOVERY_COMPLETE"]
FitLabel = Literal["Strong potential fit", "Potential fit", "Possible fit", "Low-confidence fit"]
DiscoverySource = Literal["MOCK_PUBLIC_DATA", "GOOGLE_PLACES"]
Quantity = Annotated[int, Field(strict=True, ge=1, le=2**63 - 1)]
Term = Annotated[str, Field(min_length=1, max_length=120)]


class NewManufacturingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=8000)
    location_text: str | None = Field(default=None, min_length=1, max_length=240)
    quantity: Quantity | None = None


class ManufacturingRequest(NewManufacturingRequest):
    id: str
    status: RequestStatus
    created_at: int
    owner_user_id: UUID


class SpecificationLocation(BaseModel):
    """Canonical optional location; legacy city/country payloads remain valid."""
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    display_name: str | None = Field(default=None, min_length=1, max_length=240)
    city: str | None = Field(default=None, min_length=1, max_length=120)
    country: str | None = Field(default=None, min_length=1, max_length=120)
    country_code: str | None = None
    latitude: float | None = Field(default=None, strict=True, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, strict=True, ge=-180, le=180, allow_inf_nan=False)

    @field_validator("country_code")
    @classmethod
    def supported_country(cls, value):
        if value is not None and region_code(value) is None:
            raise ValueError("country_code must be a supported two-letter country code")
        return region_code(value)

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def numeric_coordinate(cls, value):
        if isinstance(value, bool):
            raise ValueError("Coordinates must be numbers")
        return value

    @model_validator(mode="after")
    def coherent_location(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Provide both latitude and longitude")
        if self.latitude is not None and coordinates(self.model_dump()) is None:
            raise ValueError("Invalid location coordinates")
        legacy_code = region_code(self.country) or ("RS" if (self.country or "").casefold() == "serbia" else None)
        if self.country_code and legacy_code and self.country_code != legacy_code:
            raise ValueError("country and country_code must agree")
        return self


class ManufacturingSpecificationPayload(BaseModel):
    """Free taxonomy and extra JSON fields, with validated scoring inputs."""

    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    process: list[Term] = Field(min_length=1, max_length=100)
    materials: list[Term] = Field(min_length=1, max_length=100)
    quantity: Quantity | None = None
    dimensions_mm: dict[str, JsonValue] | None = None
    requirements: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(default_factory=list, max_length=100)
    location: SpecificationLocation | None = None

    @model_validator(mode="after")
    def validate_json(self):
        if "owner_user_id" in (self.model_extra or {}):
            raise ValueError("Manufacturing ownership cannot be set by the client")
        try:
            encoded = json.dumps(self.model_dump(exclude_unset=True), allow_nan=False)
        except (TypeError, ValueError):
            raise ValueError("Manufacturing specification must contain finite JSON values") from None
        if len(encoded.encode("utf-8")) > 65536:
            raise ValueError("Manufacturing specification must not exceed 64 KiB")
        return self


class ManufacturingSpecification(BaseModel):
    id: str
    request_id: str
    payload: dict[str, JsonValue]
    created_at: int


class PartnerCandidate(BaseModel):
    candidate_id: str
    name: str
    fit_score: int = Field(ge=0, le=100)
    fit_label: FitLabel
    fit_summary: str
    confidence: Literal["low", "medium"] = Field(description=(
        "Confidence that public evidence supports this manufacturing-request fit, not supplier verification. "
        "Inferred capability confidence separately describes signal specificity."
    ))
    reasoning: list[str]
    score_breakdown: dict[str, int]
    source: DiscoverySource
    is_mock: bool
    verification_status: Literal["PUBLIC_DATA_ONLY"]
    disclaimer: str
    distance_km: float | None = Field(default=None, ge=0, allow_inf_nan=False,
                                     description="Derived straight-line distance, not driving distance; null when unavailable.")


class PartnerCandidateDetail(PartnerCandidate):
    source_place_id: str
    request_id: str
    created_at: int
    last_refreshed_at: int
    partner_profile: dict[str, JsonValue]


class DiscoveryResult(BaseModel):
    request_id: str
    status: RequestStatus
    provider: DiscoverySource
    candidates: list[PartnerCandidate]
