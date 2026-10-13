"""Deterministic public-signal fit heuristic, not a manufacturing-capability guarantee."""

from dataclasses import dataclass

from backend.discovery.profile_builder import normalize_term


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

    def fraction(matched: int, requested: set, maximum: int) -> int:
        return round(maximum * matched / len(requested)) if requested else 0

    matching_materials = sum(bool(({"wood", "plywood"} if term in {"wood", "plywood"} else {term})
                                  & material_signals) for term in materials)
    breakdown = {
        "process_match": fraction(len(processes & capabilities), processes, 40),
        "material_signal": fraction(matching_materials, materials, 20),
        "equipment_signal": fraction(sum(bool(EQUIPMENT.get(term, set()) & equipment)
                                         for term in processes), processes, 15),
        "business_specialization": fraction(len(processes & specializations), processes, 10),
        "location_suitability": 0,
        "public_activity_signal": 5 if signals["public_activity_signal"] else 0,
    }
    requested_location = specification.get("location") or {}
    city = normalize_term(requested_location.get("city") or "")
    country = normalize_term(requested_location.get("country") or "")
    candidate_location = profile["location"]
    same_country = country == normalize_term(candidate_location["country"])
    if city and city == normalize_term(candidate_location["city"]) and (not country or same_country):
        breakdown["location_suitability"] = 10
    elif country and same_country:
        breakdown["location_suitability"] = 5

    reasoning = [
        "Mock public signals suggest a potential process fit." if breakdown["process_match"] else
        "No matching process signal in the mock public data.",
        "Requested materials appear in mock public signals." if breakdown["material_signal"] else
        "No matching material signal in the mock public data.",
    ]
    if breakdown["equipment_signal"]:
        reasoning.append("Relevant equipment appears in mock public signals; availability is unverified.")
    if breakdown["business_specialization"]:
        reasoning.append("Mock public specialization signals align with the requested process.")
    if breakdown["location_suitability"]:
        reasoning.append("Mock location matches the requested city." if breakdown["location_suitability"] == 10 else
                         "Mock location matches the requested country; city-level suitability is not established.")
    if breakdown["public_activity_signal"]:
        reasoning.append("The fixture includes a public activity signal.")
    reasoning.append("Quantity, dimensions and current production capacity have not been validated.")
    total = sum(breakdown.values())
    return FitScore(total, fit_label(total), breakdown, reasoning)
