"""Bounded, derived listing evidence; raw Places details remain transient."""

import math
import os
import re
import unicodedata
from urllib.parse import urlsplit

from backend.discovery.places_client import DiscoveryConfigurationError, DiscoveryProviderError
from backend.discovery.reasoning import OPERATIONAL_REASON, canonical_reasoning


DEFAULT_ENRICH_TOP_N = 3
MAX_ENRICH_TOP_N = 5
MEANINGFUL_RATING_COUNT = 10
PUBLIC_DETAIL_FIELDS = ("website", "phone", "business_status", "rating", "review_count")
BUSINESS_STATUSES = {"OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY", "FUTURE_OPENING"}


def configured_enrichment_limit() -> int:
    try:
        limit = int(os.getenv("BADEM_DISCOVERY_ENRICH_TOP_N", str(DEFAULT_ENRICH_TOP_N)))
        if not 0 <= limit <= MAX_ENRICH_TOP_N:
            raise ValueError
    except ValueError:
        raise DiscoveryConfigurationError("BADEM_DISCOVERY_ENRICH_TOP_N must be an integer between 0 and 5") from None
    return limit


def normalize_public_phone(value) -> str | None:
    """Normalize dial characters only, without inferring a country or validating reachability."""
    if not isinstance(value, str) or len(value) > 80:
        return None
    value = unicodedata.normalize("NFKC", value)
    if not re.fullmatch(r"[+0-9(). /-]+", value):
        return None
    phone = re.sub(r"[(). /-]", "", value)
    return phone if re.fullmatch(r"\+?[0-9]{3,15}", phone) else None


def normalize_public_website(value) -> str | None:
    """Retain a contact URL only; never fetch it or use its text as a fit signal."""
    if not isinstance(value, str) or len(value) > 2048 or "\\" in value:
        return None
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        return None
    value = value.strip()
    if not re.match(r"https?://[^/]", value, re.IGNORECASE) or any(character.isspace() for character in value):
        return None
    try:
        uri = urlsplit(value)
        if (uri.scheme not in {"http", "https"} or not uri.hostname or not uri.hostname.strip(".")
                or uri.username or uri.password):
            return None
        uri.port  # Validate a supplied port without changing the contact destination.
    except ValueError:
        return None
    return uri.geturl()


def derive_public_evidence(details: dict) -> dict:
    website = details.get("websiteUri")
    rating = details.get("rating")
    count = details.get("userRatingCount")
    status = details.get("businessStatus")
    try:
        if website is not None and not isinstance(website, str):
            raise ValueError
        website_present = False
        if website:
            uri = urlsplit(website)
            if uri.scheme not in {"http", "https"} or not uri.hostname:
                raise ValueError
            website_present = True
        if rating is not None and (type(rating) not in {int, float} or not math.isfinite(rating) or not 1 <= rating <= 5):
            raise ValueError
        if count is not None and (type(count) is not int or count < 0):
            raise ValueError
        if status is not None and not isinstance(status, str):
            raise ValueError
    except (ValueError, OverflowError):
        raise DiscoveryProviderError("Google Places returned malformed detail fields") from None

    activity = "NONE"
    if rating is not None and count:
        activity = "ESTABLISHED" if count >= MEANINGFUL_RATING_COUNT else "LIMITED"
    operational = "UNKNOWN"
    if status == "OPERATIONAL":
        operational = "LISTED_OPERATIONAL"
    elif status in {"CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY", "FUTURE_OPENING"}:
        operational = "LISTED_NON_OPERATIONAL"
    evidence = {"website_present": website_present, "rating_present": rating is not None,
                "public_activity_signal_strength": activity, "business_operational_signal": operational}
    phone = (normalize_public_phone(details.get("internationalPhoneNumber")) or
             normalize_public_phone(details.get("nationalPhoneNumber")))
    if phone is not None:
        evidence["phone"] = phone
    public_fields = {
        "website": normalize_public_website(website),
        "business_status": status if status in BUSINESS_STATUSES else None,
        "rating": float(rating) if rating is not None else None,
        "review_count": count,
    }
    evidence.update({field: value for field, value in public_fields.items() if value is not None})
    return evidence


def public_activity_points(evidence: dict) -> int:
    if evidence["business_operational_signal"] == "LISTED_NON_OPERATIONAL":
        return 0
    return (int(evidence["website_present"]) +
            (2 if evidence["business_operational_signal"] == "LISTED_OPERATIONAL" else 0) +
            {"NONE": 0, "LIMITED": 1, "ESTABLISHED": 2}[evidence["public_activity_signal_strength"]])


def apply_enrichment(profile: dict, evidence: dict) -> None:
    # Display fields are stored once, separately from the unchanged scoring evidence.
    evidence = dict(evidence)
    for field in PUBLIC_DETAIL_FIELDS:
        value = evidence.pop(field, None)
        profile.pop(field, None)
        if value is not None:
            profile[field] = value
    signals = []
    if evidence["website_present"]:
        signals.append("website_present")
    if evidence["business_operational_signal"] == "LISTED_OPERATIONAL":
        signals.append("operational_listing")
    if evidence["public_activity_signal_strength"] != "NONE":
        signals.append("public_activity")
    profile["enrichment"] = {"status": "ENRICHED", "signals": signals, "public_evidence": evidence}
    profile["signals"]["website_signal"] = evidence["website_present"]
    profile["signals"]["public_activity_signal"] = public_activity_points(evidence) > 0


def enrichment_reasoning(evidence: dict) -> list[str]:
    reasons = []
    if evidence["website_present"]:
        reasons.append("A public website is listed; its content has not been checked.")
    if evidence["business_operational_signal"] == "LISTED_OPERATIONAL":
        reasons.append(OPERATIONAL_REASON)
    elif evidence["business_operational_signal"] == "LISTED_NON_OPERATIONAL":
        reasons.append("The listing is not operational; no public-activity credit is awarded.")
    if evidence["public_activity_signal_strength"] != "NONE":
        reasons.append("Public rating activity is present; ratings do not establish production capability or product quality.")
    return canonical_reasoning(reasons)
