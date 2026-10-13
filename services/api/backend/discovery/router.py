"""Authenticated discovery endpoints; application wiring does not alter proof routes."""

from collections.abc import Callable

from fastapi import APIRouter, Depends, Header, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from backend.discovery.models import Database, initialize
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
    service = DiscoveryService(db)

    def authenticate(x_admin_key: str | None = Header(default=None)):
        require_admin(x_admin_key)

    router = APIRouter(prefix="/api", tags=["Manufacturing discovery"],
                       dependencies=[Depends(authenticate)], route_class=DiscoveryRoute)

    @router.post("/manufacturing-requests", status_code=201, response_model=ManufacturingRequest)
    def create_request(payload: NewManufacturingRequest):
        return service.create_request(payload)

    @router.get("/manufacturing-requests/{request_id}", response_model=ManufacturingRequest)
    def get_request(request_id: str):
        return service.get_request(request_id)

    @router.post("/manufacturing-requests/{request_id}/specification", status_code=201,
                 response_model=ManufacturingSpecification)
    def store_specification(request_id: str, payload: ManufacturingSpecificationPayload, response: Response):
        specification, created = service.store_specification(request_id, payload)
        response.status_code = 201 if created else 200
        return specification

    @router.get("/manufacturing-requests/{request_id}/specification", response_model=ManufacturingSpecification)
    def get_specification(request_id: str):
        return service.get_specification(request_id)

    @router.post("/manufacturing-requests/{request_id}/discover", response_model=DiscoveryResult)
    def discover(request_id: str):
        return service.discover(request_id)

    @router.get("/manufacturing-requests/{request_id}/candidates", response_model=DiscoveryResult)
    def get_candidates(request_id: str):
        return service.get_candidates(request_id)

    @router.get("/partner-candidates/{candidate_id}", response_model=PartnerCandidateDetail)
    def get_candidate(candidate_id: str):
        return service.get_candidate(candidate_id)

    return router
