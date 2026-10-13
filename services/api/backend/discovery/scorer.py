"""Deterministic public-signal fit heuristic, not a manufacturing-capability guarantee."""

from dataclasses import dataclass

from backend.discovery.enrichment import enrichment_reasoning, public_activity_points
from backend.discovery.models import GOOGLE_SOURCE
from backend.discovery.profile_builder import normalize_term
from backend.discovery.signals import (
    MATERIAL_FAMILIES, canonical_material, canonical_process, extract_public_signals, normalize_text,
)


WEIGHTS = {"process_match": 40, "material_signal": 20, "equipment_signal": 15,
           "business_specialization": 10, "location_suitability": 10, "public_activity_signal": 5}
EQUIPMENT = {
    "laser_engraving": {"laser", "laser_engraver"}, "laser_cutting": {"laser", "laser_cutter"},
    "cnc_milling": {"cnc_milling", "cnc_router"}, "3d_printing": {"3d_printer", "fdm_printer"},
}


@dataclass(frozen=True)
class FitScore:
    fit_score: int
    fit_label: str
    score_breakdown: dict[str, int]
    reasoning: list[str]


def fit_label(score: int) -> str:
    if not 0 <= score <= 100:
        raise ValueError("Fit score must be between 0 and 100")
    if score >= 82:
        return "Strong potential fit"
    if score >= 60:
        return "Potential fit"
    if score >= 40:
        return "Possible fit"
    return "Low-confidence fit"


def score_profile(specification: dict, profile: dict) -> FitScore:
    processes = {normalize_term(term) for term in specification.get("process", [])}
    materials = {normalize_term(term) for term in specification.get("materials", [])}
    signals = profile["signals"]
    capabilities = {item["capability"] for item in profile["inferred_capabilities"]}
    material_signals = {normalize_term(term) for term in signals["material_signals"]}
    equipment = {normalize_term(term) for term in signals["equipment_signals"]}
    specializations = {normalize_term(term) for term in signals["specialization_signals"]}
    public_signals = None
    enriched_evidence = None
    if profile["source"] == GOOGLE_SOURCE:
        processes = {canonical_process(term) for term in specification.get("process", [])}
        materials = {canonical_material(term) for term in specification.get("materials", [])}
        material_signals = {canonical_material(term) for term in signals["material_signals"]}
        public_signals = extract_public_signals(profile["display_name"], tuple(signals["specialization_signals"]))
        enrichment = profile.get("enrichment", {})
        if enrichment.get("status") == "ENRICHED":
            enriched_evidence = enrichment["public_evidence"]

    def fraction(matched: float, requested: set, maximum: int) -> int:
        return round(maximum * matched / len(requested)) if requested else 0

    matching_materials = sorted(term for term in materials if
        ({"wood", "plywood"} if term in {"wood", "plywood"} else {term}) & material_signals)
    breakdown = {
        "process_match": fraction(len(processes & capabilities), processes, 40),
        "material_signal": fraction(len(matching_materials), materials, 20),
        "equipment_signal": fraction(sum(bool(EQUIPMENT.get(term, set()) & equipment)
                                         for term in processes), processes, 15),
        "business_specialization": fraction(len(processes & specializations), processes, 10),
        "location_suitability": 0,
        "public_activity_signal": 5 if signals["public_activity_signal"] else 0,
    }
    if public_signals is not None:
        matching_processes = [public_signals.processes[term] for term in sorted(processes)
                              if term in public_signals.processes]
        breakdown["process_match"] = fraction(sum(signal.strength for signal in matching_processes), processes, 40)
        breakdown["business_specialization"] = fraction(
            sum(signal.specialization for signal in matching_processes), processes, 10)
        if enriched_evidence is not None:
            breakdown["public_activity_signal"] = public_activity_points(enriched_evidence)
    requested_location = specification.get("location") or {}
    city = normalize_term(requested_location.get("city") or "")
    country = normalize_term(requested_location.get("country") or "")
    candidate_location = profile["location"]
    if public_signals is not None:
        city = normalize_term(normalize_text(requested_location.get("city") or ""))
        country = normalize_term(normalize_text(requested_location.get("country") or ""))
        candidate_location = {key: normalize_text(value) for key, value in candidate_location.items()}
    same_country = country == normalize_term(candidate_location["country"])
    if city and city == normalize_term(candidate_location["city"]) and (not country or same_country):
        breakdown["location_suitability"] = 10
    elif country and same_country:
        breakdown["location_suitability"] = 5

    prefix = "Mock" if profile["is_mock"] else "Google Places"
    source = "mock" if profile["is_mock"] else "Google Places"
    reasoning = [
        f"{prefix} public signals suggest a potential process fit." if breakdown["process_match"] else
        f"No matching process signal in the {source} public data.",
        f"Requested materials appear in {source} public signals." if breakdown["material_signal"] else
        f"No matching material signal in the {source} public data.",
    ]
    if public_signals is not None:
        reasons = [reason for signal in matching_processes for reason in signal.reasoning]
        reasoning = list(dict.fromkeys(reasons)) or ["No matching process signal in the Google Places public data."]
        families = sorted({MATERIAL_FAMILIES.get(term, term) for term in matching_materials})
        reasoning.extend(f"Public business data contains a {family}-related material signal." for family in families)
        if not matching_materials:
            reasoning.append("No matching material signal in the Google Places public data.")
    if breakdown["equipment_signal"]:
        reasoning.append(f"Relevant equipment appears in {source} public signals; availability is unverified.")
    if breakdown["business_specialization"]:
        reasoning.append("Public business name/type signals suggest a potential specialization; capability is unverified."
                         if public_signals is not None else
                         f"{prefix} public specialization signals align with the requested process.")
    if breakdown["location_suitability"]:
        reasoning.append(f"{prefix} location matches the requested city." if breakdown["location_suitability"] == 10 else
                         f"{prefix} location matches the requested country; city-level suitability is not established.")
    if enriched_evidence is not None:
        reasoning.extend(enrichment_reasoning(enriched_evidence))
    elif breakdown["public_activity_signal"]:
        reasoning.append("The fixture includes a public activity signal." if profile["is_mock"] else
                         "The listing includes a public activity signal.")
    reasoning.append("Quantity, dimensions and current production capacity have not been validated.")
    total = sum(breakdown.values())
    return FitScore(total, fit_label(total), breakdown, reasoning)
