"""Public manufacturing-request and potential-partner API contracts."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

RequestStatus = Literal["DRAFT", "SPECIFIED", "DISCOVERY_READY", "DISCOVERY_COMPLETE"]
FitLabel = Literal["Strong potential fit", "Potential fit", "Possible fit", "Low-confidence fit"]
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


class SpecificationLocation(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    city: str | None = Field(default=None, min_length=1, max_length=120)
    country: str | None = Field(default=None, min_length=1, max_length=120)


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
    confidence: Literal["low", "medium"]
    reasoning: list[str]
    score_breakdown: dict[str, int]
    source: Literal["MOCK_PUBLIC_DATA"]
    is_mock: Literal[True]
    verification_status: Literal["PUBLIC_DATA_ONLY"]
    disclaimer: str


class PartnerCandidateDetail(PartnerCandidate):
    source_place_id: str
    request_id: str
    created_at: int
    last_refreshed_at: int
    partner_profile: dict[str, JsonValue]


class DiscoveryResult(BaseModel):
    request_id: str
    status: RequestStatus
    provider: Literal["MOCK_PUBLIC_DATA"]
    candidates: list[PartnerCandidate]
