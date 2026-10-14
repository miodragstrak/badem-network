"""Authenticated discovery endpoints; application wiring does not alter proof routes."""

import re
from collections.abc import Callable
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from backend.discovery.models import Database, initialize
from backend.discovery.providers import create_provider
from backend.discovery.schemas import (
    DiscoveryResult, ManufacturingRequest, ManufacturingSpecification, ManufacturingSpecificationPayload,
    NewManufacturingRequest, PartnerCandidateDetail,
)
from backend.discovery.service import DiscoveryService


class DiscoveryRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def validated_handler(request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                # Omit raw input: it may be large, sensitive or non-finite JSON.
                detail = [{key: value for key, value in item.items() if key in {"type", "loc", "msg"}}
                          for item in error.errors()]
                return JSONResponse(status_code=422, content={"detail": detail})

        return validated_handler


def create_discovery_router(db: Database, require_admin: Callable[[str | None], None]) -> APIRouter:
    initialize(db)
    service = DiscoveryService(db, provider=create_provider())

    def authenticate(x_admin_key: str | None = Header(default=None),
                     x_badem_user_id: list[str] | None = Header(default=None, include_in_schema=False)) -> str:
        require_admin(x_admin_key)
        if not x_badem_user_id or len(x_badem_user_id) != 1 or not re.fullmatch(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", x_badem_user_id[0],
        ):
            raise HTTPException(401, "Authenticated discovery user required")
        return str(UUID(x_badem_user_id[0]))

    router = APIRouter(prefix="/api", tags=["Manufacturing discovery"],
                       dependencies=[Depends(authenticate)], route_class=DiscoveryRoute)

    @router.post("/manufacturing-requests", status_code=201, response_model=ManufacturingRequest)
    def create_request(payload: NewManufacturingRequest, owner_user_id: str = Depends(authenticate)):
        return service.create_request(payload, owner_user_id=owner_user_id)

    @router.get("/manufacturing-requests/{request_id}", response_model=ManufacturingRequest)
    def get_request(request_id: str, owner_user_id: str = Depends(authenticate)):
        return service.get_request(request_id, owner_user_id=owner_user_id)

    @router.post("/manufacturing-requests/{request_id}/specification", status_code=201,
                 response_model=ManufacturingSpecification)
    def store_specification(request_id: str, payload: ManufacturingSpecificationPayload, response: Response,
                            owner_user_id: str = Depends(authenticate)):
        specification, created = service.store_specification(request_id, payload, owner_user_id=owner_user_id)
        response.status_code = 201 if created else 200
        return specification

    @router.get("/manufacturing-requests/{request_id}/specification", response_model=ManufacturingSpecification)
    def get_specification(request_id: str, owner_user_id: str = Depends(authenticate)):
        return service.get_specification(request_id, owner_user_id=owner_user_id)

    @router.post("/manufacturing-requests/{request_id}/discover", response_model=DiscoveryResult)
    def discover(request_id: str, owner_user_id: str = Depends(authenticate)):
        return service.discover(request_id, owner_user_id=owner_user_id)

    @router.get("/manufacturing-requests/{request_id}/candidates", response_model=DiscoveryResult)
    def get_candidates(request_id: str, owner_user_id: str = Depends(authenticate)):
        return service.get_candidates(request_id, owner_user_id=owner_user_id)

    @router.get("/partner-candidates/{candidate_id}", response_model=PartnerCandidateDetail)
    def get_candidate(candidate_id: str, owner_user_id: str = Depends(authenticate)):
        return service.get_candidate(candidate_id, owner_user_id=owner_user_id)

    return router
