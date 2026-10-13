from copy import deepcopy
import json
import sqlite3

import pytest

from backend.discovery import scorer
from backend.discovery.enrichment import apply_enrichment, derive_public_evidence, enrichment_reasoning
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.models import DISCLAIMER, VERIFICATION_STATUS
from backend.discovery.profile_builder import build_profile
from backend.discovery.reasoning import canonical_reasoning
from backend.discovery.scorer import score_profile
from test_discovery import ADMIN, SPECIFICATION, create_request, discover, specify
from test_discovery_enrichment import DETAILS, candidate_detail, enriched_setup, run_discovery
from test_discovery_signals import public_profile
from test_google_discovery import google_setup, listing


OPERATIONAL_SENTENCE = "The public listing is marked operational; capacity and current availability are not established."
COUNTRY_SENTENCE = "Google Places location matches the requested country; city-level suitability is not established."
CUTTING_NAME = "Lasersko se\u010denje Beograd"
WOOD_NAME = "Woodproject - Name\u0161taj po meri i po Va\u0161oj \u017eelji!"


def assert_spacing(reasons):
    assert OPERATIONAL_SENTENCE in reasons
    assert COUNTRY_SENTENCE in reasons
    assert all("arenot" not in reason and "isnot" not in reason for reason in reasons)


@pytest.mark.parametrize("enriched", [False, True])
@pytest.mark.parametrize("name,base_score,base_confidence,enriched_confidence", [
    ("Penda lasersko graviranje", 60, "medium", "medium"),
    ("graver doo", 40, "low", "medium"), ("Beograver", 40, "low", "medium"),
    ("Tenzor Laser", 25, "low", "low"), (WOOD_NAME, 30, "low", "low"),
    (CUTTING_NAME, 10, "low", "low"), ("Gravex", 10, "low", "low"),
    ("General workshop", 10, "low", "low"),
])
def test_fit_confidence_respects_relevant_evidence_without_changing_scores(
        name, base_score, base_confidence, enriched_confidence, enriched):
    profile = public_profile(name)
    capabilities = deepcopy(profile["inferred_capabilities"])
    if enriched:
        apply_enrichment(profile, derive_public_evidence(DETAILS))
    score = score_profile(SPECIFICATION, profile)
    assert score.fit_score == base_score + (5 if enriched else 0)
    assert score.confidence == (enriched_confidence if enriched else base_confidence)
    assert profile["inferred_capabilities"] == capabilities
    assert profile["verification_status"] == VERIFICATION_STATUS
    assert profile["disclaimer"] == DISCLAIMER
    assert score.score_breakdown["equipment_signal"] == 0
    if name in {CUTTING_NAME, WOOD_NAME}:
        assert score.score_breakdown["process_match"] == 0
    wording = json.dumps({"profile": profile, "reasoning": score.reasoning}).casefold()
    assert all(claim not in wording for claim in ("can perform", "has laser equipment", "supports plywood", "verified supplier"))


def test_cutting_signal_confidence_is_independent_of_engraving_fit_confidence():
    profile = public_profile(CUTTING_NAME)
    capability = profile["inferred_capabilities"][0]
    assert capability["capability"] == "laser_cutting"
    assert capability["confidence"] == .75
    engraving = score_profile(SPECIFICATION, profile)
    cutting = score_profile({**SPECIFICATION, "process": ["laser_cutting"]}, profile)
    assert engraving.fit_score == 10
    assert engraving.fit_label == "Low-confidence fit"
    assert engraving.confidence == "low"
    assert cutting.fit_score == 60
    assert cutting.confidence == "medium"
    assert capability["confidence"] == .75


def test_mock_confidence_also_requires_request_relevant_process_evidence():
    profile = build_profile(MockDiscoveryProvider.partners[1])
    assert profile["confidence"] == "medium"
    engraving = score_profile(SPECIFICATION, profile)
    assert engraving.score_breakdown["process_match"] == 0
    assert engraving.confidence == "low"
    cnc = score_profile({**SPECIFICATION, "process": ["cnc_milling"]}, profile)
    assert cnc.score_breakdown["process_match"] == 40
    assert cnc.confidence == "medium"


def test_higher_score_with_weak_relevant_signal_is_not_blindly_medium():
    profile = public_profile("3D Print Laser Wood")
    assert profile["confidence"] == "medium"  # An unrelated strong 3D inference exists.
    score = score_profile(SPECIFICATION, profile)
    assert score.fit_score == 45
    assert score.fit_label == "Possible fit"
    assert score.confidence == "low"
    apply_enrichment(profile, derive_public_evidence(DETAILS))
    enriched = score_profile(SPECIFICATION, profile)
    assert enriched.fit_score == 50
    assert enriched.confidence == "low"


def test_sparse_partial_fit_remains_low_despite_specific_signal_evidence():
    profile = public_profile("Penda lasersko graviranje")
    specification = {**SPECIFICATION, "process": ["laser_engraving", "3d_printing"]}
    score = score_profile(specification, profile)
    assert score.fit_score == 35
    assert score.fit_label == "Low-confidence fit"
    assert score.confidence == "low"
    assert profile["inferred_capabilities"][0]["confidence"] == .75


@pytest.mark.parametrize("field", ["websiteUri", "businessStatus", "rating", "userRatingCount"])
def test_weak_process_fit_needs_all_existing_corroboration_fields(field):
    profile = public_profile("graver doo")
    apply_enrichment(profile, derive_public_evidence({key: value for key, value in DETAILS.items() if key != field}))
    score = score_profile(SPECIFICATION, profile)
    assert score.fit_label == "Possible fit"
    assert score.confidence == "low"


def test_exact_spacing_at_enrichment_scorer_and_scored_profile_levels():
    assert OPERATIONAL_SENTENCE in enrichment_reasoning(derive_public_evidence(DETAILS))
    profile = public_profile("Penda lasersko graviranje")
    apply_enrichment(profile, derive_public_evidence(DETAILS))
    specification = {**SPECIFICATION, "location": {"city": "Novi Sad", "country": "RS"}}
    score = score_profile(specification, profile)
    assert_spacing(score.reasoning)
    profile.update({"reasoning": score.reasoning, "confidence": score.confidence})
    assert_spacing(profile["reasoning"])
    assert profile["confidence"] == "medium"


def test_scorer_repairs_reported_string_assembly_variants(monkeypatch):
    profile = public_profile("Penda lasersko graviranje")
    apply_enrichment(profile, derive_public_evidence(DETAILS))
    monkeypatch.setattr(scorer, "enrichment_reasoning", lambda _: [OPERATIONAL_SENTENCE.replace("are not", "arenot")])
    monkeypatch.setattr(scorer, "COUNTRY_LOCATION_REASON", COUNTRY_SENTENCE.removeprefix("Google Places ").replace("is not", "isnot"))
    score = score_profile({**SPECIFICATION, "location": {"country": "RS"}}, profile)
    assert_spacing(score.reasoning)


def test_wording_repair_is_narrow_idempotent_and_preserves_unrelated_text():
    reasons = [OPERATIONAL_SENTENCE.replace("are not", "arenot"),
               COUNTRY_SENTENCE.replace("is not", "isnot"), "Business name contains 'laser engraving'."]
    expected = [OPERATIONAL_SENTENCE, COUNTRY_SENTENCE, reasons[2]]
    assert canonical_reasoning(reasons) == expected
    assert canonical_reasoning(expected) == expected
    assert "arenot" in reasons[0]  # Do not mutate caller-owned snapshots.


def test_google_discovery_confidence_is_request_fit_specific_and_persisted(google_setup):
    client, db_path, payload, calls = google_setup
    names = {"cutting": CUTTING_NAME, "penda": "Penda lasersko graviranje",
             "graver": "graver doo", "wood": WOOD_NAME, "laser": "Tenzor Laser"}
    payload["places"] = [listing(place_id, name) for place_id, name in names.items()]
    request_id = create_request(client)
    specify(client, request_id)
    response = discover(client, request_id)
    assert response.status_code == 200, response.text
    assert len(calls) == 3
    result = response.json()
    by_name = {candidate["name"]: candidate for candidate in result["candidates"]}
    cutting = by_name[CUTTING_NAME]
    assert (cutting["fit_score"], cutting["fit_label"], cutting["confidence"]) == (10, "Low-confidence fit", "low")
    assert cutting["score_breakdown"]["process_match"] == cutting["score_breakdown"]["material_signal"] == 0
    assert by_name[names["penda"]]["fit_score"] == 60
    assert by_name[names["penda"]]["confidence"] == "medium"
    assert by_name[names["graver"]]["fit_label"] == "Possible fit"
    assert by_name[WOOD_NAME]["score_breakdown"]["material_signal"] == 20
    assert by_name[WOOD_NAME]["score_breakdown"]["process_match"] == 0
    for candidate in result["candidates"]:
        detail = candidate_detail(client, candidate)
        assert detail["partner_profile"]["confidence"] == candidate["confidence"]
        assert candidate["verification_status"] == detail["partner_profile"]["verification_status"] == VERIFICATION_STATUS
        assert candidate["disclaimer"] == detail["partner_profile"]["disclaimer"] == DISCLAIMER
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    with sqlite3.connect(db_path) as connection:
        row = connection.execute("SELECT confidence,profile_json FROM public_capacity_profiles WHERE candidate_id=?",
                                 (cutting["candidate_id"],)).fetchone()
        assert row[0] == json.loads(row[1])["confidence"] == "low"


def test_enriched_google_activity_does_not_upgrade_a_mismatched_process_fit(enriched_setup):
    client, _, _, upstream = enriched_setup
    upstream.records = [listing("cutting", CUTTING_NAME)]
    result = run_discovery(enriched_setup)
    assert upstream.detail_ids() == ["cutting"]
    candidate = result["candidates"][0]
    assert (candidate["fit_score"], candidate["fit_label"], candidate["confidence"]) == (15, "Low-confidence fit", "low")
    assert candidate["score_breakdown"]["public_activity_signal"] == 5
    profile = candidate_detail(client, candidate)["partner_profile"]
    assert profile["confidence"] == "low"
    assert profile["inferred_capabilities"] == [{"capability": "laser_cutting", "confidence": .75,
        "evidence": ["business name contains 'lasersko secenje'"]}]


def test_exact_reasoning_survives_google_discovery_database_storage_and_api_reads(enriched_setup):
    client, db_path, request_id, upstream = enriched_setup
    upstream.records = [listing("penda", "Penda lasersko graviranje")]
    specify(client, request_id, {**SPECIFICATION, "location": {"city": "Novi Sad", "country": "RS"}})
    result = run_discovery(enriched_setup)
    candidate = result["candidates"][0]
    assert_spacing(candidate["reasoning"])
    read = client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json()["candidates"][0]
    assert_spacing(read["reasoning"])
    detail = candidate_detail(client, candidate)
    assert_spacing(detail["reasoning"])
    assert_spacing(detail["partner_profile"]["reasoning"])
    with sqlite3.connect(db_path) as connection:
        stored = json.loads(connection.execute("SELECT profile_json FROM public_capacity_profiles").fetchone()[0])
        assert_spacing(stored["reasoning"])
    assert len(upstream.searches) == 3
    assert upstream.detail_ids() == ["penda"]


def test_legacy_persisted_typos_and_location_only_confidence_are_corrected_without_network_or_rewrites(enriched_setup):
    client, db_path, request_id, upstream = enriched_setup
    upstream.records = [listing("cutting", CUTTING_NAME)]
    specify(client, request_id, {**SPECIFICATION, "location": {"city": "Novi Sad", "country": "RS"}})
    candidate = run_discovery(enriched_setup)["candidates"][0]
    with sqlite3.connect(db_path) as connection:
        row = connection.execute("SELECT profile_json FROM public_capacity_profiles WHERE candidate_id=?",
                                 (candidate["candidate_id"],)).fetchone()
        legacy = json.loads(row[0])
        legacy["confidence"] = "medium"
        legacy["reasoning"] = [OPERATIONAL_SENTENCE.replace("are not", "arenot"),
                               COUNTRY_SENTENCE.replace("is not", "isnot")]
        encoded = json.dumps(legacy)
        connection.execute("UPDATE public_capacity_profiles SET profile_json=?,confidence='medium' WHERE candidate_id=?",
                           (encoded, candidate["candidate_id"]))
    before_calls = len(upstream.searches) + len(upstream.details)
    read = client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json()["candidates"][0]
    assert read["confidence"] == "low"
    assert_spacing(read["reasoning"])
    detail = candidate_detail(client, candidate)
    assert detail["confidence"] == detail["partner_profile"]["confidence"] == "low"
    assert_spacing(detail["reasoning"])
    assert_spacing(detail["partner_profile"]["reasoning"])
    assert len(upstream.searches) + len(upstream.details) == before_calls
    with sqlite3.connect(db_path) as connection:
        stored = connection.execute("SELECT profile_json,confidence FROM public_capacity_profiles WHERE candidate_id=?",
                                    (candidate["candidate_id"],)).fetchone()
        assert stored == (encoded, "medium")
