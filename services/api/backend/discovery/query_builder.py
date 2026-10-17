"""Small, deterministic manufacturing searches; no parsing service or geocoding."""

from backend.discovery.countries import country_query_text
from backend.discovery.geo import coordinates, location_country
from backend.discovery.profile_builder import normalize_term


MAX_QUERIES = 3
MAX_QUERY_POOL = 9
PROCESS_QUERIES = {
    "laser_engraving": ("laser engraving service", "laser cutting service", "sign making",
                        "custom fabrication", "woodworking", "CNC / laser workshop"),
    "laser_cutting": ("laser cutting service", "laser fabrication workshop", "sign making",
                      "custom fabrication", "CNC / laser workshop", "laser engraving service"),
    "cnc_milling": ("CNC machining service", "precision machining workshop", "machine shop",
                    "custom fabrication", "CNC milling workshop", "metal fabrication service"),
    "cnc_machining": ("CNC machining service", "precision machining workshop", "machine shop",
                       "custom fabrication", "CNC milling workshop", "metal fabrication service"),
    "cnc_wood": ("CNC wood machining service", "woodworking service", "custom furniture workshop",
                 "CNC wood workshop", "custom fabrication", "CNC / laser workshop"),
    "3d_printing": ("3D printing service", "additive manufacturing service", "rapid prototyping workshop",
                    "prototype fabrication", "3D printing workshop", "maker workshop"),
    "prototyping": ("rapid prototyping service", "prototype fabrication workshop", "maker workshop",
                    "custom fabrication", "CNC machining service", "3D printing service"),
    "maker": ("maker fabrication workshop", "prototype fabrication workshop", "rapid prototyping service",
              "custom fabrication", "woodworking", "3D printing service"),
    "maker_workshop": ("maker fabrication workshop", "prototype fabrication workshop", "rapid prototyping service",
                       "custom fabrication", "woodworking", "3D printing service"),
}


def build_queries(specification: dict, *, limit: int = MAX_QUERIES) -> list[str]:
    limit = max(0, min(limit, MAX_QUERY_POOL))
    if not limit:
        return []
    processes = sorted({normalize_term(term) for term in specification.get("process", [])})
    materials = {normalize_term(term) for term in specification.get("materials", [])}
    location = specification.get("location") or {}
    city = " ".join((location.get("city") or location.get("display_name") or "").split())
    if coordinates(location) is not None:
        city = ""  # The geographic viewport, not a city name, governs expanded searches.
    suffix = " ".join(value for value in (city, country_query_text(location_country(location))) if value)
    families = []
    for process in processes:
        templates = PROCESS_QUERIES.get(process)
        if templates is None:
            continue
        if process in {"cnc_milling", "cnc_machining"} and materials & {"wood", "plywood"}:
            templates = PROCESS_QUERIES["cnc_wood"]
        elif process in {"laser_engraving", "laser_cutting"} and materials & {"wood", "plywood"}:
            templates = tuple(text if "wood" in text.casefold() else f"{text} wood" for text in templates)
        families.append(templates)

    # Round-robin gives each requested process a first query before adding variants.
    queries = []
    for variants in zip(*families):
        for text in variants:
            query = f"{text} {suffix}".strip()
            if query not in queries:
                queries.append(query)
                if len(queries) == limit:
                    return queries
    return queries
