import pytest

from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.models import DISCLAIMER, GOOGLE_SOURCE, MOCK_SOURCE, PublicPartnerData
from backend.discovery.profile_builder import build_profile
from backend.discovery.scorer import WEIGHTS, fit_label, score_profile


@pytest.mark.parametrize("score,label", [
    (0, "Low-confidence fit"), (39, "Low-confidence fit"), (40, "Possible fit"), (59, "Possible fit"),
    (60, "Potential fit"), (81, "Potential fit"), (82, "Strong potential fit"), (100, "Strong potential fit"),
])
def test_exact_fit_label_thresholds(score, label):
    assert fit_label(score) == label


@pytest.mark.parametrize("score", [-1, 101])
def test_score_out_of_bounds_is_rejected(score):
    with pytest.raises(ValueError, match="between 0 and 100"):
        fit_label(score)


def test_scorer_is_transparent_deterministic_and_caps_categories():
    specification = {"process": ["laser_engraving"], "materials": ["plywood"],
                     "location": {"city": "Belgrade", "country": "RS"}}
    provider = MockDiscoveryProvider()
    assert provider.discover(specification) == provider.discover(specification)
    for partner in provider.discover(specification):
        profile = build_profile(partner)
        score = score_profile(specification, profile)
        assert score == score_profile(specification, profile)
        assert score.fit_score == sum(score.score_breakdown.values())
        assert all(0 <= score.score_breakdown[category] <= maximum for category, maximum in WEIGHTS.items())
        assert profile["verification_status"] == "PUBLIC_DATA_ONLY"
        assert profile["disclaimer"] == DISCLAIMER
        assert profile["confidence"] in {"low", "medium"}
        assert profile["is_mock"] is True


def test_known_process_aliases_and_duplicate_terms_do_not_inflate_score():
    profile = build_profile(MockDiscoveryProvider.partners[0])
    canonical = {"process": ["laser_engraving"], "materials": ["plywood"],
                 "location": {"city": "Belgrade", "country": "RS"}}
    aliases = {"process": ["Laser engraving", "laser_engraving"], "materials": ["Plywood", "plywood"],
               "location": {"city": "Beograd", "country": "Serbia"}}
    assert score_profile(canonical, profile) == score_profile(aliases, profile)
    assert score_profile(canonical, profile).fit_score == 100


def test_multiple_requested_processes_and_materials_receive_partial_credit():
    profile = build_profile(MockDiscoveryProvider.partners[0])
    result = score_profile({"process": ["laser_engraving", "3d_printing"], "materials": ["wood", "pla"]}, profile)
    assert result.score_breakdown == {"process_match": 20, "material_signal": 10, "equipment_signal": 8,
                                      "business_specialization": 5, "location_suitability": 0,
                                      "public_activity_signal": 5}
    assert result.fit_score == 48


@pytest.mark.parametrize("location,expected", [
    ({}, 0), ({"country": "RS"}, 5), ({"city": "Novi Sad", "country": "RS"}, 5),
    ({"city": "Belgrade"}, 10), ({"city": "Belgrade", "country": "US"}, 0),
])
def test_location_fit_never_invents_distance_or_ignores_country_mismatch(location, expected):
    profile = build_profile(MockDiscoveryProvider.partners[0])
    result = score_profile({"process": ["laser_engraving"], "materials": ["plywood"], "location": location}, profile)
    assert result.score_breakdown["location_suitability"] == expected


def test_missing_public_signals_produce_low_confidence_without_capability_claims():
    profile = build_profile(PublicPartnerData("mock-sparse", "General workshop", "Unknown", "Unknown"))
    score = score_profile({"process": ["laser_engraving"], "materials": ["plywood"]}, profile)
    assert profile["inferred_capabilities"] == []
    assert profile["confidence"] == "low"
    assert score.fit_score == 0
    assert score.fit_label == "Low-confidence fit"
    assert "can manufacture" not in " ".join(score.reasoning).casefold()
    assert profile["disclaimer"] == DISCLAIMER


@pytest.mark.parametrize("source,prefix", [(MOCK_SOURCE, "Mock"), (GOOGLE_SOURCE, "Google Places")])
@pytest.mark.parametrize("location", [{"country": "RS"}, {"city": "Novi Sad", "country": "RS"}])
def test_country_only_location_reasoning_has_exact_correct_spacing(source, prefix, location):
    profile = build_profile(PublicPartnerData("wording-test", "General workshop", "Belgrade", "RS", source=source))
    score = score_profile({"process": ["laser_engraving"], "materials": ["wood"], "location": location}, profile)
    assert score.score_breakdown["location_suitability"] == 5
    assert [reason for reason in score.reasoning if reason.startswith(f"{prefix} location")] == [
        f"{prefix} location matches the requested country; city-level suitability is not established.",
    ]
    assert all("isnot" not in reason for reason in score.reasoning)
