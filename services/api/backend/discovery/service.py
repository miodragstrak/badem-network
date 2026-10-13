"""Transactional manufacturing specification -> mock discovery -> ranked partner profiles."""

import json
import time
import uuid
from collections.abc import Callable

from fastapi import HTTPException

from backend.discovery import models
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.profile_builder import build_profile
from backend.discovery.schemas import ManufacturingSpecificationPayload, NewManufacturingRequest
from backend.discovery.scorer import score_profile


class DiscoveryService:
    def __init__(self, db: models.Database, provider: MockDiscoveryProvider | None = None,
                 clock: Callable[[], float] = time.time):
        self.db = db
        self.provider = provider if provider is not None else MockDiscoveryProvider()
        self.clock = clock

    @staticmethod
    def require_request(connection, request_id: str) -> dict:
        request = models.get_request(connection, request_id)
        if request is None:
            raise HTTPException(404, "Manufacturing request not found")
        return request

    def create_request(self, payload: NewManufacturingRequest) -> dict:
        request = {**payload.model_dump(), "id": str(uuid.uuid4()), "status": "DRAFT",
                   "created_at": int(self.clock())}
        with self.db() as connection:
            models.insert_request(connection, request)
        return request

    def get_request(self, request_id: str) -> dict:
        with self.db() as connection:
            return self.require_request(connection, request_id)

    def store_specification(self, request_id: str, payload: ManufacturingSpecificationPayload) -> tuple[dict, bool]:
        with self.db() as connection:
            self.require_request(connection, request_id)
            previous = models.get_specification(connection, request_id)
            specification = {
                "id": previous["id"] if previous else str(uuid.uuid4()), "request_id": request_id,
                "payload": payload.model_dump(mode="json", exclude_unset=True),
                "created_at": previous["created_at"] if previous else int(self.clock()),
            }
            models.save_specification(connection, specification)
        return specification, previous is None

    def get_specification(self, request_id: str) -> dict:
        with self.db() as connection:
            self.require_request(connection, request_id)
            specification = models.get_specification(connection, request_id)
            if specification is None:
                raise HTTPException(404, "Manufacturing specification not found")
            return specification

    @staticmethod
    def candidate_response(row: dict, detailed: bool = False) -> dict:
        profile = json.loads(row["profile_json"])
        result = {
            "candidate_id": row["id"], "name": profile["display_name"], "fit_score": row["fit_score"],
            "fit_label": row["fit_label"], "fit_summary": profile["fit_summary"],
            "confidence": row["confidence"], "reasoning": profile["reasoning"],
            "score_breakdown": profile["score_breakdown"], "source": row["source"],
            "is_mock": True, "verification_status": row["verification_status"], "disclaimer": profile["disclaimer"],
        }
        if detailed:
            result.update({"source_place_id": row["source_place_id"],
                           "request_id": row["discovered_for_request_id"], "created_at": row["created_at"],
                           "last_refreshed_at": row["last_refreshed_at"], "partner_profile": profile})
        return result

    def results(self, connection, request: dict) -> dict:
        return {"request_id": request["id"], "status": request["status"], "provider": models.MOCK_SOURCE,
                "candidates": [self.candidate_response(row) for row in models.get_candidates(connection, request["id"])]}

    def discover(self, request_id: str) -> dict:
        with self.db() as connection:
            request = self.require_request(connection, request_id)
            specification = models.get_specification(connection, request_id)
            if specification is None:
                raise HTTPException(409, "Store a manufacturing specification before discovery")
            models.set_status(connection, request_id, "DISCOVERY_READY")
            results = []
            for partner in self.provider.discover(specification["payload"]):
                profile = build_profile(partner)
                score = score_profile(specification["payload"], profile)
                profile.update({"fit_score": score.fit_score, "fit_label": score.fit_label,
                                "fit_summary": f"{score.fit_label} based on public data",
                                "reasoning": score.reasoning, "score_breakdown": score.score_breakdown})
                candidate_id = str(uuid.uuid5(uuid.NAMESPACE_URL,
                    f"badem:discovery:{request_id}:{partner.source}:{partner.source_place_id}"))
                results.append({"id": candidate_id, "source": partner.source,
                                "source_place_id": partner.source_place_id,
                                "profile_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"badem:capacity-profile:{candidate_id}")),
                                "profile": profile})
            models.replace_candidates(connection, request_id, results, int(self.clock()))
            models.set_status(connection, request_id, "DISCOVERY_COMPLETE")
            request["status"] = "DISCOVERY_COMPLETE"
            return self.results(connection, request)

    def get_candidates(self, request_id: str) -> dict:
        with self.db() as connection:
            return self.results(connection, self.require_request(connection, request_id))

    def get_candidate(self, candidate_id: str) -> dict:
        with self.db() as connection:
            row = models.get_candidate(connection, candidate_id)
            if row is None:
                raise HTTPException(404, "Partner candidate not found")
            return self.candidate_response(row, detailed=True)
