"""Manufacturing specification -> source discovery -> atomically persisted rankings."""

import json
import time
import uuid
from collections.abc import Callable

from fastapi import HTTPException

from backend.discovery import models
from backend.discovery.enrichment import MAX_ENRICH_TOP_N, apply_enrichment
from backend.discovery.geo import RELEVANCE_CATEGORIES, coordinates, ranking_key, straight_line_km
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.places_client import DiscoveryProviderError
from backend.discovery.profile_builder import build_profile
from backend.discovery.reasoning import canonical_reasoning
from backend.discovery.schemas import ManufacturingSpecificationPayload, NewManufacturingRequest
from backend.discovery.scorer import score_profile


class DiscoveryService:
    def __init__(self, db: models.Database, provider: models.DiscoveryProvider | None = None,
                 clock: Callable[[], float] = time.time):
        self.db = db
        self.provider = provider if provider is not None else MockDiscoveryProvider()
        self.clock = clock

    @staticmethod
    def require_request(connection, request_id: str, owner_user_id: str) -> dict:
        request = models.get_request(connection, request_id, owner_user_id)
        if request is None:
            raise HTTPException(404, "Manufacturing request not found")
        return request

    def create_request(self, payload: NewManufacturingRequest, *, owner_user_id: str) -> dict:
        request = {**payload.model_dump(), "id": str(uuid.uuid4()), "status": "DRAFT",
                   "created_at": int(self.clock()), "owner_user_id": owner_user_id}
        with self.db() as connection:
            models.insert_request(connection, request)
        return request

    def get_request(self, request_id: str, *, owner_user_id: str) -> dict:
        with self.db() as connection:
            return self.require_request(connection, request_id, owner_user_id)

    def store_specification(self, request_id: str, payload: ManufacturingSpecificationPayload,
                            *, owner_user_id: str) -> tuple[dict, bool]:
        with self.db() as connection:
            self.require_request(connection, request_id, owner_user_id)
            previous = models.get_specification(connection, request_id)
            specification = {
                "id": previous["id"] if previous else str(uuid.uuid4()), "request_id": request_id,
                "payload": payload.model_dump(mode="json", exclude_unset=True),
                "created_at": previous["created_at"] if previous else int(self.clock()),
            }
            models.save_specification(connection, specification)
        return specification, previous is None

    def get_specification(self, request_id: str, *, owner_user_id: str) -> dict:
        with self.db() as connection:
            self.require_request(connection, request_id, owner_user_id)
            specification = models.get_specification(connection, request_id)
            if specification is None:
                raise HTTPException(404, "Manufacturing specification not found")
            return specification

    @staticmethod
    def candidate_response(row: dict, detailed: bool = False) -> dict:
        profile = json.loads(row["profile_json"])
        profile["reasoning"] = canonical_reasoning(profile["reasoning"])
        profile["confidence"] = row["confidence"]
        # Keep legacy location/activity-only snapshots conservative without rescoring.
        if row["fit_score"] < 40 or profile["score_breakdown"]["process_match"] == 0:
            profile["confidence"] = "low"
        result = {
            "candidate_id": row["id"], "name": profile["display_name"], "fit_score": row["fit_score"],
            "fit_label": row["fit_label"], "fit_summary": profile["fit_summary"],
            "confidence": profile["confidence"], "reasoning": profile["reasoning"],
            "score_breakdown": profile["score_breakdown"], "source": row["source"],
            "is_mock": row["source"] == models.MOCK_SOURCE,
            "verification_status": row["verification_status"], "disclaimer": profile["disclaimer"],
            "distance_km": profile.get("distance_km"),
        }
        if detailed:
            result.update({"source_place_id": row["source_place_id"],
                           "request_id": row["discovered_for_request_id"], "created_at": row["created_at"],
                           "last_refreshed_at": row["last_refreshed_at"], "partner_profile": profile})
        return result

    def results(self, connection, request: dict) -> dict:
        rows = models.get_candidates(connection, request["id"])
        specification = models.get_specification(connection, request["id"])
        if specification and coordinates(specification["payload"].get("location")) is not None:
            rows.sort(key=lambda row: ranking_key(json.loads(row["profile_json"]), row["source_place_id"], geo=True))
        source = rows[0]["source"] if rows else getattr(self.provider, "source", models.MOCK_SOURCE)
        return {"request_id": request["id"], "status": request["status"], "provider": source,
                "candidates": [self.candidate_response(row) for row in rows]}

    def discover(self, request_id: str, *, owner_user_id: str) -> dict:
        with self.db() as connection:
            self.require_request(connection, request_id, owner_user_id)
            specification = models.get_specification(connection, request_id)
            if specification is None:
                raise HTTPException(409, "Store a manufacturing specification before discovery")
        # Do not hold a SQLite write lock during external provider I/O.
        try:
            partners = self.provider.discover(specification["payload"])
        except DiscoveryProviderError as error:
            raise HTTPException(error.status_code, str(error)) from None
        results = []
        origin = coordinates(specification["payload"].get("location"))
        for partner in partners:
            profile = build_profile(partner)
            destination = coordinates(profile["location"])
            if origin is not None and destination is not None:
                profile["distance_km"] = round(straight_line_km(origin, destination), 3)
            score = score_profile(specification["payload"], profile)
            if not any(score.score_breakdown[category] > 0 for category in RELEVANCE_CATEGORIES):
                continue
            profile.update({"fit_score": score.fit_score, "fit_label": score.fit_label, "confidence": score.confidence,
                            "fit_summary": f"{score.fit_label} based on public data",
                            "reasoning": score.reasoning, "score_breakdown": score.score_breakdown})
            candidate_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                f"badem:discovery:{request_id}:{partner.source}:{partner.source_place_id}"))
            results.append({"id": candidate_id, "source": partner.source,
                            "source_place_id": partner.source_place_id,
                            "profile_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"badem:capacity-profile:{candidate_id}")),
                            "profile": profile})
        enrich = getattr(self.provider, "enrich", None)
        if enrich is not None and getattr(self.provider, "source", None) == models.GOOGLE_SOURCE:
            limit = max(0, min(getattr(self.provider, "enrich_top_n", 0), MAX_ENRICH_TOP_N))
            ranked = sorted(results, key=lambda row: ranking_key(row["profile"], row["source_place_id"], geo=origin is not None))
            for result in ranked[:limit]:
                profile = result["profile"]
                try:
                    evidence = enrich(result["source_place_id"])
                except DiscoveryProviderError:
                    profile["enrichment"] = {"status": "UNAVAILABLE", "signals": []}
                    continue
                apply_enrichment(profile, evidence)
                score = score_profile(specification["payload"], profile)
                profile.update({"fit_score": score.fit_score, "fit_label": score.fit_label, "confidence": score.confidence,
                                "fit_summary": f"{score.fit_label} based on public data",
                                "reasoning": score.reasoning, "score_breakdown": score.score_breakdown})
        with self.db() as connection:
            request = self.require_request(connection, request_id, owner_user_id)
            if models.get_specification(connection, request_id) != specification:
                raise HTTPException(409, "Manufacturing specification changed during discovery; retry")
            models.set_status(connection, request_id, "DISCOVERY_READY")
            models.replace_candidates(connection, request_id, results, int(self.clock()))
            models.set_status(connection, request_id, "DISCOVERY_COMPLETE")
            request["status"] = "DISCOVERY_COMPLETE"
            return self.results(connection, request)

    def get_candidates(self, request_id: str, *, owner_user_id: str) -> dict:
        with self.db() as connection:
            return self.results(connection, self.require_request(connection, request_id, owner_user_id))

    def get_candidate(self, candidate_id: str, *, owner_user_id: str) -> dict:
        with self.db() as connection:
            row = models.get_candidate(connection, candidate_id, owner_user_id)
            if row is None:
                raise HTTPException(404, "Partner candidate not found")
            return self.candidate_response(row, detailed=True)
