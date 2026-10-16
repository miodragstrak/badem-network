import pytest

from backend.discovery.query_builder import MAX_QUERIES, build_queries


@pytest.mark.parametrize("process,materials,expected", [
    ("laser_engraving", ["plywood"], "laser engraving service wood Belgrade Serbia"),
    ("laser_cutting", ["acrylic"], "laser cutting service Belgrade Serbia"),
    ("cnc", ["wood"], "CNC wood machining service Belgrade Serbia"),
    ("cnc_milling", ["steel"], "CNC machining service Belgrade Serbia"),
    ("cnc_machining", ["plywood"], "CNC wood machining service Belgrade Serbia"),
    ("cnc_wood", ["plywood"], "CNC wood machining service Belgrade Serbia"),
    ("3d_print", ["pla"], "3D printing service Belgrade Serbia"),
    ("prototyping", ["wood"], "rapid prototyping service Belgrade Serbia"),
    ("maker_workshop", ["wood"], "maker fabrication workshop Belgrade Serbia"),
])
def test_supported_process_queries_are_bounded_specific_and_deterministic(process, materials, expected):
    specification = {"process": [process], "materials": materials,
                     "location": {"city": "Belgrade", "country": "RS"}}
    queries = build_queries(specification)
    assert queries == build_queries(specification)
    assert queries[0] == expected
    assert len(queries) == MAX_QUERIES == len(set(queries)) == 3
    assert all(query.endswith("Belgrade Serbia") for query in queries)


@pytest.mark.parametrize("location,suffix", [
    (None, ""), ({}, ""), ({"city": "Novi Sad"}, " Novi Sad"),
    ({"country": "RS"}, " Serbia"), ({"city": " New   York ", "country": " US "}, " New York US"),
    ({"city": " Bor ", "country": " rs "}, " Bor Serbia"),
    ({"city": "Bor", "country": "Serbia"}, " Bor Serbia"),
    ({"city": "Bor", "country": "   "}, " Bor"),
])
def test_optional_location_is_used_without_inventing_one(location, suffix):
    assert build_queries({"process": ["laser_engraving"], "materials": ["acrylic"],
                          "location": location})[0] == "laser engraving service" + suffix


def test_multprocess_queries_are_order_independent_and_share_the_small_budget():
    original = {"process": ["laser_engraving", "cnc", "3d_printing"], "materials": ["plywood"]}
    reordered = {"process": ["3d_printing", "cnc_milling", "laser_engraving", "cnc"], "materials": ["plywood"]}
    assert build_queries(original) == build_queries(reordered) == [
        "3D printing service", "CNC wood machining service", "laser engraving service wood",
    ]


def test_equivalent_query_families_are_deduplicated():
    queries = build_queries({"process": ["cnc_milling", "cnc_machining", "cnc_wood"], "materials": ["wood"]})
    assert len(queries) == len(set(queries)) == 3


def test_unknown_taxonomy_does_not_issue_generic_paid_searches():
    assert build_queries({"process": ["future_process"], "materials": ["future_material"]}) == []


def test_quantity_dimensions_and_requirements_do_not_expand_or_leak_into_queries():
    specification = {"process": ["laser_engraving"], "materials": ["plywood"]}
    assert build_queries(specification) == build_queries({**specification, "quantity": 300,
        "dimensions_mm": {"width": 12}, "requirements": ["customer-specific confidential instruction"]})
