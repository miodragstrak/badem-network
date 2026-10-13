"""Derive a Public Capacity Profile from source signals, never supplier verification."""

import re

from backend.discovery.models import DISCLAIMER, VERIFICATION_STATUS, PublicPartnerData


def normalize_term(value: str) -> str:
    value = value.strip().casefold().replace("-", "_").replace(" ", "_")
    return {"cnc": "cnc_milling", "3d_print": "3d_printing", "beograd": "belgrade",
            "serbia": "rs"}.get(value, value)


PROCESS_SIGNALS = {
    "laser_engraving": ({"laser", "laser_engraving"}, {"engraving", "laser_engraving"}),
    "laser_cutting": ({"laser", "laser_cutting"}, {"cutting", "laser_cutting"}),
    "cnc_milling": ({"cnc_milling", "cnc_router", "milling", "routing"},),
    "3d_printing": ({"3d", "3d_printing"}, {"print", "printing", "3d_printing"}),
}


def build_profile(partner: PublicPartnerData) -> dict:
    sources = {
        "mock business name": re.findall(r"[a-z0-9]+", partner.display_name.casefold()),
        "mock public website": partner.website_keywords,
        "mock public keyword signal": partner.review_keywords,
        "mock equipment signal": partner.equipment,
        "mock specialization signal": partner.specializations,
    }
    normalized = {name: {normalize_term(value) for value in values} for name, values in sources.items()}
    all_signals = set().union(*normalized.values())
    capabilities = []
    for capability, groups in PROCESS_SIGNALS.items():
        if not all(group & all_signals for group in groups):
            continue
        relevant = set().union(*groups)
        evidence = [name for name, values in normalized.items() if values & relevant]
        capabilities.append({"capability": capability, "confidence": round(min(.86, .38 + .12 * len(evidence)), 2),
                             "evidence": evidence})
    confidence = "medium" if any(item["confidence"] >= .65 for item in capabilities) else "low"
    return {
        "display_name": partner.display_name,
        "location_summary": f"{partner.city}, {partner.country}",
        "location": {"city": partner.city, "country": partner.country},
        "signals": {
            "laser_related_name": "laser" in normalized["mock business name"],
            "website_signal": bool(partner.website_keywords),
            "review_keyword_signals": list(partner.review_keywords),
            "material_signals": list(partner.materials),
            "equipment_signals": list(partner.equipment),
            "specialization_signals": list(partner.specializations),
            "public_activity_signal": partner.public_activity,
        },
        "inferred_capabilities": capabilities,
        "confidence": confidence,
        "source": partner.source,
        "is_mock": True,
        "verification_status": VERIFICATION_STATUS,
        "disclaimer": DISCLAIMER,
    }
