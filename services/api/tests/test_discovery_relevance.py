"""Manufacturing evidence, not location or activity alone, qualifies a new candidate."""

import sqlite3

import pytest

from backend.discovery.geo import RELEVANCE_CATEGORIES
from backend.discovery.models import MOCK_SOURCE, PublicPartnerData
from backend.discovery.profile_builder import build_profile
from backend.discovery.scorer import score_profile
from backend.discovery.service import DiscoveryService
from test_discovery import ADMIN, OWNER_USER_ID, SPECIFICATION, connection_factory, create_request, discover, setup, specify
from test_discovery_enrichment import enriched_setup
from test_discovery_geo import GEO_SPEC, ORIGIN, geo_place
from test_google_discovery import google_setup, listing


@pytest.mark.parametrize("geo", [False, True], ids=["text-only", "geo"])
@pytest.mark.parametrize("signals,process,category", [
    pytest.param({}, "laser_engraving", None, id="location-only"),
    pytest.param({"public_activity": True, "city": "", "country": ""},
                 "laser_engraving", None, id="public-activity-only"),
    pytest.param({"public_activity": True}, "laser_engraving", None, id="location-and-activity-only"),
    pytest.param({"materials": ("wood",)}, "laser_engraving", "material_signal", id="material-only"),
    pytest.param({"equipment": ("laser",)}, "laser_engraving", "equipment_signal", id="equipment-only"),
    pytest.param({"specializations": ("cnc_wood",)}, "cnc_wood", "business_specialization", id="specialization-only"),
    pytest.param({"website_keywords": ("laser_engraving",)}, "laser_engraving", "process_match", id="process-only"),
])
def test_manufacturing_relevance_gate_before_persistence(setup, geo, signals, process, category):
    client, db_path = setup
    specification = {**(GEO_SPEC if geo else SPECIFICATION), "process": [process]}
    fields = {"city": specification["location"]["city"], "country": "RS", **signals}
    partner = PublicPartnerData("signal-fixture", "Independent workshop", **fields,
                                latitude=ORIGIN[0] if geo else None, longitude=ORIGIN[1] if geo else None)
    score = score_profile(specification, build_profile(partner))
    positive_categories = {key for key in RELEVANCE_CATEGORIES if score.score_breakdown[key] > 0}
    assert positive_categories == ({category} if category else set())
    assert score.score_breakdown["public_activity_signal"] == (5 if signals.get("public_activity") else 0)
    assert score.score_breakdown["location_suitability"] == (0 if "city" in signals else 10)

    class Provider:
        source = MOCK_SOURCE

        def discover(self, payload):
            assert payload == specification
            return [partner]

    request_id = create_request(client)
    assert specify(client, request_id, specification).status_code == 201
    service = DiscoveryService(lambda: connection_factory(db_path), provider=Provider())
    result = service.discover(request_id, owner_user_id=OWNER_USER_ID)
    expected_count = int(category is not None)
    assert result["status"] == "DISCOVERY_COMPLETE"
    assert len(result["candidates"]) == expected_count
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    with sqlite3.connect(db_path) as connection:
        for table in ("partner_candidates", "public_capacity_profiles"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (expected_count,)
    if category:
        candidate = result["candidates"][0]
        assert candidate["score_breakdown"] == score.score_breakdown
        assert candidate["fit_score"] == score.fit_score
        assert candidate["confidence"] == score.confidence
        detail = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN).json()
        assert detail["partner_profile"]["score_breakdown"] == score.score_breakdown
        assert candidate["verification_status"] == "PUBLIC_DATA_ONLY"


@pytest.mark.parametrize("geo", [False, True], ids=["text-only", "geo"])
def test_google_retail_is_excluded_while_wood_and_process_matches_receive_bounded_enrichment(enriched_setup, geo):
    client, db_path, request_id, upstream = enriched_setup
    make_place = geo_place if geo else listing
    retail = make_place("retail", name="Local Tool Retail")
    retail.update({"primaryType": "hardware_store", "types": ["hardware_store", "store"]})
    upstream.records = [retail,
        make_place("material", name="Woodproject - Name\u0161taj po meri i po Va\u0161oj \u017eelji!"),
        make_place("process", name="Penda lasersko graviranje")]
    specification = GEO_SPEC if geo else SPECIFICATION
    assert specify(client, request_id, specification).status_code == 200
    response = discover(client, request_id)
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert len(candidates) == 2
    assert upstream.detail_ids() == ["process", "material"], "Activity cannot rescue irrelevant retail or spend its detail budget"
    assert len(upstream.searches) == (9 if geo else 3)
    assert candidates[0]["score_breakdown"]["process_match"] > 0
    assert candidates[1]["score_breakdown"]["material_signal"] > 0
    assert candidates[1]["score_breakdown"]["process_match"] == 0
    assert all(candidate["score_breakdown"]["public_activity_signal"] == 5 for candidate in candidates)
    with sqlite3.connect(db_path) as connection:
        assert {row[0] for row in connection.execute("SELECT source_place_id FROM partner_candidates")} == {"material", "process"}


def test_rediscovery_with_only_irrelevant_results_clears_prior_candidates(google_setup):
    client, db_path, payload, _ = google_setup
    request_id = create_request(client)
    assert specify(client, request_id, GEO_SPEC).status_code == 201
    payload["places"] = [geo_place("previous")]
    previous = discover(client, request_id).json()["candidates"][0]
    payload["places"] = [geo_place("retail", name="Local Tool Retail")]
    response = discover(client, request_id)
    assert response.status_code == 200
    assert response.json()["status"] == "DISCOVERY_COMPLETE"
    assert response.json()["candidates"] == []
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == response.json()
    assert client.get(f"/api/partner-candidates/{previous['candidate_id']}", headers=ADMIN).status_code == 404
    with sqlite3.connect(db_path) as connection:
        for table in ("partner_candidates", "public_capacity_profiles"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)
