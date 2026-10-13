"""Fixed fictional source fixtures; no scraping, Google calls or live business data."""

from backend.discovery.models import PublicPartnerData
from backend.discovery.profile_builder import normalize_term


class MockDiscoveryProvider:
    partners = (
        PublicPartnerData(
            "mock-laser-belgrade", "Laser Studio Belgrade", "Belgrade", "RS",
            website_keywords=("laser_engraving", "laser_cutting", "wood", "plywood"),
            review_keywords=("laser", "engraving", "wood"), materials=("wood", "plywood"),
            equipment=("laser",), specializations=("laser_engraving", "laser_cutting"), public_activity=True,
        ),
        PublicPartnerData(
            "mock-cnc-novi-sad", "CNC Wood Lab", "Novi Sad", "RS",
            website_keywords=("cnc_milling", "wood", "plywood"), review_keywords=("cnc", "wood"),
            materials=("wood", "plywood"), equipment=("cnc_router",),
            specializations=("cnc_milling",), public_activity=True,
        ),
        PublicPartnerData(
            "mock-maker-nis", "Maker Workshop Serbia", "Nis", "RS",
            website_keywords=("laser", "engraving", "3d_printing", "wood"),
            review_keywords=("engraving", "wood"), materials=("wood",),
        ),
        PublicPartnerData(
            "mock-3d-belgrade", "3D Print & Prototype Studio", "Belgrade", "RS",
            website_keywords=("3d_printing", "printing", "pla", "abs"), review_keywords=("3d", "print"),
            materials=("pla", "abs"), equipment=("3d_printer",),
            specializations=("3d_printing",), public_activity=True,
        ),
        PublicPartnerData("mock-general-belgrade", "General Repair Workshop", "Belgrade", "RS",
                          review_keywords=("repair",)),
    )

    def discover(self, specification: dict) -> list[PublicPartnerData]:
        requested = {normalize_term(term) for term in specification.get("process", [])}
        return sorted(self.partners, key=lambda partner: (
            not bool(requested & {normalize_term(term) for term in partner.specializations}),
            partner.source_place_id,
        ))
