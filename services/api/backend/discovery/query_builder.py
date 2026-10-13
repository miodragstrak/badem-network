"""Small, deterministic manufacturing searches; no parsing service or geocoding."""

from backend.discovery.profile_builder import normalize_term


MAX_QUERIES = 3
PROCESS_QUERIES = {
    "laser_engraving": ("laser engraving service", "laser engraving workshop", "custom laser engraving"),
    "laser_cutting": ("laser cutting service", "laser cutting workshop", "custom laser cutting"),
    "cnc_milling": ("CNC machining service", "CNC milling workshop", "custom CNC machining"),
    "cnc_machining": ("CNC machining service", "CNC milling workshop", "custom CNC machining"),
    "cnc_wood": ("CNC wood machining service", "CNC wood workshop", "custom CNC wood routing"),
    "3d_printing": ("3D printing service", "3D printing workshop", "rapid prototyping 3D printing"),
    "prototyping": ("rapid prototyping service", "prototype fabrication workshop", "maker workshop"),
    "maker": ("maker fabrication workshop", "prototype fabrication workshop", "rapid prototyping service"),
    "maker_workshop": ("maker fabrication workshop", "prototype fabrication workshop", "rapid prototyping service"),
}


def build_queries(specification: dict) -> list[str]:
    processes = sorted({normalize_term(term) for term in specification.get("process", [])})
    materials = {normalize_term(term) for term in specification.get("materials", [])}
    location = specification.get("location") or {}
    suffix = " ".join(" ".join((location.get(key) or "").split()) for key in ("city", "country")).strip()
    families = []
    for process in processes:
        templates = PROCESS_QUERIES.get(process)
        if templates is None:
            continue
        if process in {"cnc_milling", "cnc_machining"} and materials & {"wood", "plywood"}:
            templates = PROCESS_QUERIES["cnc_wood"]
        elif process in {"laser_engraving", "laser_cutting"} and materials & {"wood", "plywood"}:
            templates = tuple(f"{text} wood" for text in templates)
        families.append(templates)

    # Round-robin gives each requested process a first query before adding variants.
    queries = []
    for variants in zip(*families):
        for text in variants:
            query = f"{text} {suffix}".strip()
            if query not in queries:
                queries.append(query)
                if len(queries) == MAX_QUERIES:
                    return queries
    return queries
