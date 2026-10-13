"""Canonical wording and narrow repairs for known historical reasoning defects."""


OPERATIONAL_REASON = "The public listing is marked operational; capacity and current availability are not established."
COUNTRY_LOCATION_REASON = "location matches the requested country; city-level suitability is not established."
SPACING_REPAIRS = {
    "capacity and current availability arenot established.": "capacity and current availability are not established.",
    "city-level suitability isnot established.": "city-level suitability is not established.",
}


def canonical_reasoning(reasons: list[str]) -> list[str]:
    result = []
    for reason in reasons:
        for incorrect, correct in SPACING_REPAIRS.items():
            reason = reason.replace(incorrect, correct)
        result.append(reason)
    return result
