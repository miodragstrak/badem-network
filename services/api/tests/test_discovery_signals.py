import json

import pytest

from backend.discovery.google_provider import normalize_place
from backend.discovery.models import DISCLAIMER, GOOGLE_SOURCE, VERIFICATION_STATUS
from backend.discovery.profile_builder import build_profile
from backend.discovery.scorer import WEIGHTS, score_profile
from backend.discovery.signals import extract_public_signals, normalize_text


SPECIFICATION = {"process": ["laser_engraving"], "materials": ["plywood"],
                 "location": {"city": "Belgrade", "country": "RS"}}


def public_profile(name, types=(), city="Belgrade", country="RS"):
    partner = normalize_place({"id": "signal-test", "displayName": {"text": name}, "types": list(types),
        "addressComponents": [{"longText": city, "types": ["locality"]},
                              {"shortText": country, "types": ["country"]}]})
    return build_profile(partner)


@pytest.mark.parametrize("text,expected", [
    ("LASERSKO GRAVIRANJE", "lasersko graviranje"),
    ("lasersko se\u010denje", "lasersko secenje"), ("lasersko secenje", "lasersko secenje"),
    ("3D \u0161tampa", "3d stampa"), ("3D stampa", "3d stampa"),
    ("\u0161perplo\u010da", "sperploca"), ("sperploca", "sperploca"),
    ("\u0160PER", "sper"), ("s\u030cperploc\u030ca", "sperploca"),
    ("  CNC_OBRADA / Laser-cutting & wood  ", "cnc obrada laser cutting wood"),
    ("\u0110 \u0106 \u010c \u017d \u0160", "dj c c z s"),
    ("\u516c\u53f8", "\u516c\u53f8"),
])
def test_unicode_normalization_is_deterministic_and_idempotent(text, expected):
    assert normalize_text(text) == expected
    assert normalize_text(normalize_text(text)) == expected


@pytest.mark.parametrize("phrase,capability", [
    ("laser engraving", "laser_engraving"), ("lasersko graviranje", "laser_engraving"),
    ("laser cutting", "laser_cutting"), ("lasersko se\u010denje", "laser_cutting"),
    ("lasersko secenje", "laser_cutting"), ("se\u010denje laserom", "laser_cutting"),
    ("secenje laserom", "laser_cutting"), ("cnc machining", "cnc_milling"),
    ("cnc obrada", "cnc_milling"), ("cnc glodanje", "cnc_milling"),
    ("3d printing", "3d_printing"), ("3d print", "3d_printing"),
    ("3d \u0161tampa", "3d_printing"), ("3d stampa", "3d_printing"),
    ("additive manufacturing", "3d_printing"), ("prototype", "prototyping"),
    ("prototyping", "prototyping"), ("prototip", "prototyping"),
    ("prototipiranje", "prototyping"), ("maker workshop", "prototyping"), ("makerspace", "prototyping"),
])
def test_explicit_process_phrases_provide_bounded_evidence(phrase, capability):
    signals = extract_public_signals(f"Studio {phrase}")
    signal = signals.processes[capability]
    assert signal.strength == signal.specialization == 1
    assert signal.confidence == .75
    assert f"business name contains '{normalize_text(phrase)}'" in signal.evidence
    assert all(0 < item.strength <= 1 for item in signals.processes.values())


@pytest.mark.parametrize("phrase,capability,strength", [
    ("graviranje", "laser_engraving", .6), ("engraving", "laser_engraving", .6),
    ("graver", "laser_engraving", .6), ("engraver", "laser_engraving", .6),
    ("Beograver", "laser_engraving", .6), ("Photograver", "laser_engraving", .6),
    ("cnc", "cnc_milling", .8), ("glodanje", "cnc_milling", .6), ("milling", "cnc_milling", .6),
    ("Laser", "laser_engraving", .25),
])
def test_generic_process_terms_have_partial_not_full_strength(phrase, capability, strength):
    signal = extract_public_signals(phrase).processes[capability]
    assert signal.strength == strength < 1
    assert signal.confidence < .65


@pytest.mark.parametrize("word,material", [
    ("wood", "wood"), ("wooden", "wood"), ("woodworking", "wood"), ("Wooding", "wood"),
    ("woodcraft", "wood"), ("drvo", "wood"), ("drveni", "wood"), ("stolarija", "wood"),
    ("plywood", "plywood"), ("\u0161per", "plywood"), ("sper", "plywood"),
    ("\u0161perplo\u010da", "plywood"), ("sperploca", "plywood"),
    ("metal", "metal"), ("steel", "steel"), ("aluminum", "aluminum"),
    ("aluminium", "aluminum"), ("metalworking", "metal"), ("metalna obrada", "metal"),
    ("plastic", "plastic"), ("plastika", "plastic"), ("acrylic", "acrylic"),
    ("akril", "acrylic"), ("plexiglass", "acrylic"), ("pleksiglas", "acrylic"),
])
def test_material_terms_are_not_process_or_equipment_claims(word, material):
    extracted = extract_public_signals(f"{word} Studio")
    assert material in extracted.materials
    assert extracted.processes == {}


@pytest.mark.parametrize("name", [
    "General repair workshop", "Gravex", "print studio", "3d cinema", "manufacturer",
    "graverobber", "engravingly", "laserlight show", "Woodstock", "Woodland", "Hollywood",
    "metallica", "plasticity", "sperplocastudio", "namestajland", "stolarland", "furnitureland", "Woodproject",
])
def test_unrelated_words_and_substring_collisions_do_not_become_manufacturing_signals(name):
    extracted = extract_public_signals(name)
    assert extracted.processes == {}
    assert extracted.materials == set()
    profile = public_profile(name)
    score = score_profile(SPECIFICATION, profile)
    assert score.fit_score == score.score_breakdown["location_suitability"] == 10
    assert profile["confidence"] == "low"


@pytest.mark.parametrize("name", [
    "Penda lasersko graviranje", "Laser Print - Reklamni materijal i brendiranje", "graver doo",
    "Beograver", "Gravex", "DARK MARK Graver", "Tenzor Laser", "Wooding Studio",
    "3D Print & Prototype Studio",
])
def test_observed_names_remain_public_unverified_deterministic_and_within_category_caps(name):
    profile = public_profile(name)
    score = score_profile(SPECIFICATION, profile)
    assert profile == public_profile(name)
    assert score == score_profile(SPECIFICATION, profile)
    assert 0 <= score.fit_score <= 100
    assert score.fit_score == sum(score.score_breakdown.values())
    assert all(0 <= score.score_breakdown[key] <= limit for key, limit in WEIGHTS.items())
    assert score.score_breakdown["equipment_signal"] == score.score_breakdown["public_activity_signal"] == 0
    assert profile["source"] == GOOGLE_SOURCE
    assert profile["is_mock"] is False
    assert profile["verification_status"] == VERIFICATION_STATUS
    assert profile["disclaimer"] == DISCLAIMER
    wording = json.dumps({"profile": profile, "reasoning": score.reasoning}).casefold()
    assert all(claim not in wording for claim in (
        "can perform", "has laser equipment", "supports plywood", "verified supplier", "can manufacture"))


def test_explicit_laser_engraving_outranks_partial_laser_and_engraving_terms():
    scores = {name: score_profile(SPECIFICATION, public_profile(name)) for name in (
        "Penda lasersko graviranje", "graver doo", "Tenzor Laser",
        "Laser Print - Reklamni materijal i brendiranje", "General repair workshop")}
    explicit, engraving, generic = [scores[name] for name in (
        "Penda lasersko graviranje", "graver doo", "Tenzor Laser")]
    assert explicit.score_breakdown["process_match"] == 40
    assert explicit.score_breakdown["business_specialization"] == 10
    assert explicit.fit_score > engraving.fit_score > generic.fit_score > 10
    assert 0 < generic.score_breakdown["process_match"] < engraving.score_breakdown["process_match"] < 40
    assert scores["Laser Print - Reklamni materijal i brendiranje"].score_breakdown["business_specialization"] > 0
    assert "Business name contains an explicit laser engraving signal." in explicit.reasoning
    assert "Business name contains an engraving-related public signal." in engraving.reasoning
    assert "Business name contains a laser-related public signal." in generic.reasoning


@pytest.mark.parametrize("material", ["plywood", "wood", "\u0161perplo\u010da"])
def test_wooding_material_signal_does_not_create_a_process_claim(material):
    profile = public_profile("Wooding Studio")
    score = score_profile({**SPECIFICATION, "materials": [material]}, profile)
    assert score.score_breakdown["material_signal"] > 0
    assert score.score_breakdown["process_match"] == score.score_breakdown["business_specialization"] == 0
    assert profile["inferred_capabilities"] == []
    assert "Public business data contains a wood-related material signal." in score.reasoning


def test_3d_printing_and_prototyping_are_independent_of_laser_engraving():
    profile = public_profile("3D Print & Prototype Studio")
    assert {item["capability"] for item in profile["inferred_capabilities"]} == {"3d_printing", "prototyping"}
    for process in ("3d_printing", "prototyping"):
        assert score_profile({**SPECIFICATION, "process": [process]}, profile).score_breakdown["process_match"] == 40
    assert score_profile(SPECIFICATION, profile).score_breakdown["process_match"] == 0


@pytest.mark.parametrize("name,other_process", [
    ("Penda lasersko graviranje", "laser_cutting"), ("Lasersko secenje Studio", "laser_engraving"),
    ("Lasersko se\u010denje Beograd", "laser_engraving"),
])
def test_specific_laser_process_does_not_imply_the_other_process(name, other_process):
    profile = public_profile(name)
    assert other_process not in {item["capability"] for item in profile["inferred_capabilities"]}
    assert score_profile({**SPECIFICATION, "process": [other_process]}, profile).score_breakdown["process_match"] == 0


def test_type_signals_use_the_same_rules_without_generic_type_capability_claims():
    generic = public_profile("General Studio", ("manufacturer", "point_of_interest", "establishment"))
    assert generic["inferred_capabilities"] == []
    profile = public_profile("General Studio", ("laser_engraving", "woodworking"))
    score = score_profile(SPECIFICATION, profile)
    assert score.score_breakdown["process_match"] == 40
    assert score.score_breakdown["material_signal"] == 20
    assert score.score_breakdown["equipment_signal"] == 0
    assert profile["inferred_capabilities"][0]["evidence"] == [
        "google places type contains 'laser engraving'", "google places type contains 'engraving'"]
    assert "Google Places type contains an explicit laser engraving signal." in score.reasoning


def test_duplicate_phrases_and_type_order_do_not_accumulate_confidence_or_points():
    baseline = public_profile("Laser Laser Engraving Studio", ("laser_engraving", "laser_engraving", "manufacturer"))
    reordered = public_profile("Laser Laser Engraving Studio", ("manufacturer", "laser_engraving"))
    assert baseline == reordered
    score = score_profile(SPECIFICATION, baseline)
    assert score.score_breakdown["process_match"] == 40
    assert score.score_breakdown["business_specialization"] == 10
    assert all(item["confidence"] == .75 for item in baseline["inferred_capabilities"])


def test_aliases_duplicates_and_multiple_requested_processes_remain_bounded():
    profile = public_profile("CNC obrada and 3D stampa plywood")
    canonical = {**SPECIFICATION, "process": ["cnc_milling", "3d_printing"], "materials": ["plywood"]}
    aliases = {**SPECIFICATION, "process": ["CNC machining", "cnc_milling", "3d_print", "3d_printing"],
               "materials": ["plywood", "\u0161perplo\u010da"]}
    assert score_profile(canonical, profile) == score_profile(aliases, profile)
    extended = {**canonical, "process": ["cnc_machining", "3d_printing", "laser_engraving"]}
    score = score_profile(extended, profile)
    assert score.score_breakdown["process_match"] == round(40 * 2 / 3)
    assert score.score_breakdown["business_specialization"] == round(10 * 2 / 3)
    assert all(0 <= score.score_breakdown[key] <= limit for key, limit in WEIGHTS.items())


@pytest.mark.parametrize("name,requested,expected", [
    ("metal Studio", "steel", 0), ("plastika Studio", "acrylic", 0),
    ("steel Studio", "metal", 20), ("aluminium Studio", "aluminum", 20),
    ("akril Studio", "plastic", 20), ("pleksiglas Studio", "acrylic", 20),
])
def test_material_families_do_not_invent_specific_metal_or_polymer_evidence(name, requested, expected):
    assert score_profile({**SPECIFICATION, "materials": [requested]},
                         public_profile(name)).score_breakdown["material_signal"] == expected


def test_address_words_are_location_only_not_process_or_material_evidence():
    profile = public_profile("General Studio", city="Laser Engraving Wood Street")
    score = score_profile(SPECIFICATION, profile)
    assert profile["inferred_capabilities"] == []
    assert profile["signals"]["material_signals"] == []
    assert score.fit_score == 5  # Same country, but no city/process/material match.


def test_google_location_normalization_preserves_diacritics_equivalence_and_country_mismatch():
    profile = public_profile("General Studio", city="\u010ca\u010dak")
    specification = {**SPECIFICATION, "location": {"city": "Cacak", "country": "RS"}}
    assert score_profile(specification, profile).score_breakdown["location_suitability"] == 10
    specification["location"]["country"] = "US"
    assert score_profile(specification, profile).score_breakdown["location_suitability"] == 0


@pytest.mark.parametrize("name,processes,process_points,specialization_points", [
    ("Penda lasersko graviranje", ["laser_engraving", "3d_printing"], 20, 5),
    ("Tenzor Laser", ["laser_engraving", "laser_cutting"], 10, 5),
    ("Tenzor Laser", ["laser_engraving", "laser_cutting", "3d_printing"], 7, 3),
    ("graver doo", ["laser_engraving", "3d_printing"], 12, 3),
    ("CNC Studio", ["cnc_machining"], 32, 8),
])
def test_partial_signal_credit_is_proportional_across_multiple_requests(
        name, processes, process_points, specialization_points):
    score = score_profile({**SPECIFICATION, "process": processes}, public_profile(name))
    assert score.score_breakdown["process_match"] == process_points
    assert score.score_breakdown["business_specialization"] == specialization_points
    assert score.fit_score <= 100


@pytest.mark.parametrize("term", [
    "name\u0161taj", "namestaj", "stolar", "stolarija", "furniture", "woodwork", "woodworking",
])
@pytest.mark.parametrize("material", ["wood", "plywood"])
def test_furniture_and_carpentry_terms_are_material_only_public_signals(term, material):
    name = f"{term} Studio"
    extracted = extract_public_signals(name)
    assert extracted.materials == {"wood"}
    assert extracted.processes == {}
    profile = public_profile(name)
    score = score_profile({**SPECIFICATION, "materials": [material]}, profile)
    assert score.score_breakdown == {
        "process_match": 0, "material_signal": 20, "equipment_signal": 0,
        "business_specialization": 0, "location_suitability": 10, "public_activity_signal": 0,
    }
    assert profile["inferred_capabilities"] == []
    assert profile["verification_status"] == VERIFICATION_STATUS
    assert profile["disclaimer"] == DISCLAIMER
    assert "Public business data contains a wood-related material signal." in score.reasoning
    wording = json.dumps({"profile": profile, "reasoning": score.reasoning}).casefold()
    assert all(claim not in wording for claim in (
        "can perform", "has laser equipment", "supports plywood", "verified supplier", "can manufacture"))


def test_woodproject_furniture_fixture_uses_existing_unicode_normalization():
    accented = public_profile("Woodproject - Name\u0161taj po meri i po Va\u0161oj \u017eelji!")
    ascii_profile = public_profile("Woodproject - Namestaj po meri i po Vasoj zelji!")
    assert accented["signals"] == ascii_profile["signals"]
    assert score_profile(SPECIFICATION, accented) == score_profile(SPECIFICATION, ascii_profile)
    assert score_profile(SPECIFICATION, accented).fit_score == 30
