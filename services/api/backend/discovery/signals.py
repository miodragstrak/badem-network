"""Deterministic public-name/type signals, not a production capability inventory."""

import re
import unicodedata
from dataclasses import dataclass, field


def normalize_text(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value.casefold().replace("\u0111", "dj"))
    folded = "".join(character for character in folded if not unicodedata.combining(character))
    return " ".join(re.findall(r"[^\W_]+", folded))


PROCESS_PHRASES = {
    "laser_engraving": ("laser engraving", "lasersko graviranje", "laser engraver"),
    "laser_cutting": ("laser cutting", "lasersko secenje", "secenje laserom"),
    "cnc_milling": ("cnc machining", "cnc milling", "cnc obrada", "cnc glodanje"),
    "3d_printing": ("3d printing", "3d print", "3d stampa", "additive manufacturing"),
    "prototyping": ("prototype", "prototyping", "prototip", "prototipiranje", "maker workshop", "makerspace"),
}
ENGRAVING_TERMS = ("graviranje", "engraving", "graver", "engraver")
MILLING_TERMS = ("glodanje", "milling")
LASER_TERMS = ("laser", "lasersko", "laserski", "laserom")
MATERIAL_TERMS = {
    "wood": ("wood", "wooden", "woodworking", "drvo", "drveni", "stolarija", "carpenter", "carpentry"),
    "plywood": ("plywood", "sper", "sperploca"),
    "metal": ("metal", "metalworking", "metalna obrada"),
    "steel": ("steel",),
    "aluminum": ("aluminum", "aluminium"),
    "plastic": ("plastic", "plastika"),
    "acrylic": ("acrylic", "akril", "plexiglass", "pleksiglas"),
    "pla": ("pla",),
    "abs": ("abs",),
}
MATERIAL_FAMILIES = {"plywood": "wood", "steel": "metal", "aluminum": "metal",
                     "acrylic": "plastic", "pla": "plastic", "abs": "plastic"}


def canonical_process(value: str) -> str:
    term = normalize_text(value).replace(" ", "_")
    return {"cnc": "cnc_milling", "cnc_machining": "cnc_milling", "cnc_wood": "cnc_milling",
            "3d_print": "3d_printing", "maker": "prototyping", "maker_workshop": "prototyping"}.get(term, term)


def canonical_material(value: str) -> str:
    term = normalize_text(value)
    for material, aliases in MATERIAL_TERMS.items():
        if term in aliases:
            return material
    return term.replace(" ", "_")


def matching_phrases(text: str, phrases: tuple[str, ...]) -> list[str]:
    return [phrase for phrase in phrases if f" {phrase} " in f" {text} "]


@dataclass
class ProcessSignal:
    strength: float
    specialization: float
    confidence: float
    evidence: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)


@dataclass
class PublicSignals:
    processes: dict[str, ProcessSignal] = field(default_factory=dict)
    materials: set[str] = field(default_factory=set)
    laser_related_name: bool = False

    def capabilities(self) -> list[dict]:
        return [{"capability": capability, "confidence": signal.confidence, "evidence": signal.evidence}
                for capability, signal in sorted(self.processes.items())]


def extract_public_signals(display_name: str, place_types: tuple[str, ...] = ()) -> PublicSignals:
    result = PublicSignals()
    sources = [("Business name", normalize_text(display_name))]
    sources.extend(("Google Places type", normalize_text(value)) for value in sorted(set(place_types)))
    laser_evidence = []

    def add(capability, phrases, source, description, strength=1., specialization=1., confidence=.75):
        if not phrases:
            return
        signal = result.processes.setdefault(capability, ProcessSignal(strength, specialization, confidence))
        if strength > signal.strength:
            signal.strength, signal.specialization, signal.confidence = strength, specialization, confidence
            signal.reasoning.clear()
        for phrase in phrases:
            evidence = f"{source.lower()} contains '{phrase}'"
            if evidence not in signal.evidence:
                signal.evidence.append(evidence)
        if strength == signal.strength:
            reason = f"{source} contains {description}."
            if reason not in signal.reasoning:
                signal.reasoning.append(reason)

    for source, text in sources:
        for capability, phrases in PROCESS_PHRASES.items():
            description = {"laser_engraving": "an explicit laser engraving signal",
                           "laser_cutting": "an explicit laser cutting signal",
                           "cnc_milling": "an explicit CNC machining signal",
                           "3d_printing": "an explicit 3D printing signal",
                           "prototyping": "a prototyping-related public signal"}[capability]
            add(capability, matching_phrases(text, phrases), source, description)

        engraving = matching_phrases(text, ENGRAVING_TERMS)
        # Bounded word forms catch compounds without matching arbitrary substrings.
        engraving.extend(word for word in text.split() if re.fullmatch(r"[a-z]{2,}(?:engraver|graver)", word))
        add("laser_engraving", engraving, source, "an engraving-related public signal", .6, .6, .55)
        add("cnc_milling", matching_phrases(text, ("cnc",)), source,
            "a CNC-related public signal", .8, .8, .6)
        add("cnc_milling", matching_phrases(text, MILLING_TERMS), source,
            "a milling-related public signal", .6, .6, .55)

        laser = matching_phrases(text, LASER_TERMS)
        if source == "Business name":
            result.laser_related_name = bool(laser)
        if laser:
            laser_evidence.append((source, laser))
        for material, phrases in MATERIAL_TERMS.items():
            if matching_phrases(text, phrases):
                result.materials.add(material)
        if any(re.fullmatch(r"wood(?:work(?:er|ers|ing)?|crafts?|ing)", word) for word in text.split()):
            result.materials.add("wood")

    # Generic laser evidence cannot imply another process beside a more specific one.
    if not result.processes.keys() & {"laser_engraving", "laser_cutting"}:
        for source, laser in laser_evidence:
            for capability in ("laser_engraving", "laser_cutting"):
                add(capability, laser, source, "a laser-related public signal", .25, .5, .3)
    result.materials.update(MATERIAL_FAMILIES[term] for term in tuple(result.materials) if term in MATERIAL_FAMILIES)
    return result
