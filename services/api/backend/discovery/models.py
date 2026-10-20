"""Discovery entities and additive SQLite storage using the API's transaction helper."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Protocol


Database = Callable[[], AbstractContextManager[sqlite3.Connection]]
DISCLAIMER = "Potential fit based on public data. Production capability has not been verified."
VERIFICATION_STATUS = "PUBLIC_DATA_ONLY"
MOCK_SOURCE = "MOCK_PUBLIC_DATA"
GOOGLE_SOURCE = "GOOGLE_PLACES"

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS manufacturing_requests (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        location_text TEXT,
        quantity INTEGER CHECK(quantity IS NULL OR quantity > 0),
        status TEXT NOT NULL CHECK(status IN
            ('DRAFT','SPECIFIED','DISCOVERY_READY','DISCOVERY_COMPLETE')),
        created_at INTEGER NOT NULL,
        owner_user_id TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS manufacturing_specifications (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE REFERENCES manufacturing_requests(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        created_at INTEGER NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS partner_candidates (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('MOCK_PUBLIC_DATA','GOOGLE_PLACES')),
        source_place_id TEXT NOT NULL,
        discovered_for_request_id TEXT NOT NULL REFERENCES manufacturing_requests(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_refreshed_at INTEGER NOT NULL,
        UNIQUE(discovered_for_request_id, source, source_place_id)
    )""",
    """CREATE TABLE IF NOT EXISTS public_capacity_profiles (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL UNIQUE REFERENCES partner_candidates(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL CHECK(json_valid(profile_json)),
        fit_score INTEGER NOT NULL CHECK(fit_score BETWEEN 0 AND 100),
        fit_label TEXT NOT NULL CHECK(fit_label IN
            ('Strong potential fit','Potential fit','Possible fit','Low-confidence fit')),
        confidence TEXT NOT NULL CHECK(confidence IN ('low','medium')),
        verification_status TEXT NOT NULL CHECK(verification_status = 'PUBLIC_DATA_ONLY'),
        created_at INTEGER NOT NULL
    )""",
)


@dataclass(frozen=True)
class PublicPartnerData:
    """Discovery-source signals, not a verified production capability inventory."""

    source_place_id: str
    display_name: str
    city: str
    country: str
    website_keywords: tuple[str, ...] = ()
    review_keywords: tuple[str, ...] = ()
    materials: tuple[str, ...] = ()
    equipment: tuple[str, ...] = ()
    specializations: tuple[str, ...] = ()
    public_activity: bool = False
    source: str = MOCK_SOURCE
    latitude: float | None = None
    longitude: float | None = None
    address: str | None = None


class DiscoveryProvider(Protocol):
    def discover(self, specification: dict) -> list[PublicPartnerData]: ...


def initialize(db: Database) -> None:
    with db() as connection:
        for statement in SCHEMA:
            connection.execute(statement)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(manufacturing_requests)")}
        if "owner_user_id" not in columns:
            # Existing requests stay ownerless and private; never claim them on first access.
            connection.execute("ALTER TABLE manufacturing_requests ADD COLUMN owner_user_id TEXT")


def get_request(connection: sqlite3.Connection, request_id: str, owner_user_id: str) -> dict | None:
    row = connection.execute(
        "SELECT * FROM manufacturing_requests WHERE id=? AND owner_user_id=?", (request_id, owner_user_id),
    ).fetchone()
    return dict(row) if row is not None else None


def insert_request(connection: sqlite3.Connection, request: dict) -> None:
    connection.execute(
        "INSERT INTO manufacturing_requests "
        "(id,title,description,location_text,quantity,status,created_at,owner_user_id) "
        "VALUES(:id,:title,:description,:location_text,:quantity,:status,:created_at,:owner_user_id)", request,
    )


def get_specification(connection: sqlite3.Connection, request_id: str) -> dict | None:
    row = connection.execute(
        "SELECT * FROM manufacturing_specifications WHERE request_id=?", (request_id,),
    ).fetchone()
    if row is None:
        return None
    result = dict(row)
    result["payload"] = json.loads(result.pop("payload_json"))
    return result


def save_specification(connection: sqlite3.Connection, specification: dict) -> None:
    connection.execute(
        "INSERT INTO manufacturing_specifications (id,request_id,payload_json,created_at) "
        "VALUES(?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET payload_json=excluded.payload_json",
        (specification["id"], specification["request_id"],
         json.dumps(specification["payload"], allow_nan=False), specification["created_at"]),
    )
    connection.execute(
        "DELETE FROM partner_candidates WHERE discovered_for_request_id=?", (specification["request_id"],),
    )
    set_status(connection, specification["request_id"], "SPECIFIED")


def set_status(connection: sqlite3.Connection, request_id: str, status: str) -> None:
    connection.execute("UPDATE manufacturing_requests SET status=? WHERE id=?", (status, request_id))


PROFILE_SELECT = (
    "SELECT c.*, p.id AS profile_id, p.profile_json, p.fit_score, p.fit_label, "
    "p.confidence, p.verification_status, p.created_at AS profile_created_at "
    "FROM partner_candidates c JOIN public_capacity_profiles p ON p.candidate_id=c.id "
)


def get_candidates(connection: sqlite3.Connection, request_id: str) -> list[dict]:
    return [dict(row) for row in connection.execute(
        PROFILE_SELECT + "WHERE c.discovered_for_request_id=? ORDER BY p.fit_score DESC,c.source_place_id ASC",
        (request_id,),
    ).fetchall()]


def get_candidate(connection: sqlite3.Connection, candidate_id: str, owner_user_id: str) -> dict | None:
    row = connection.execute(
        PROFILE_SELECT + "JOIN manufacturing_requests r ON r.id=c.discovered_for_request_id "
        "WHERE c.id=? AND r.owner_user_id=?", (candidate_id, owner_user_id),
    ).fetchone()
    return dict(row) if row is not None else None


def replace_candidates(connection: sqlite3.Connection, request_id: str, results: list[dict], now: int) -> None:
    previous = {row["id"]: row for row in get_candidates(connection, request_id)}
    connection.execute("DELETE FROM partner_candidates WHERE discovered_for_request_id=?", (request_id,))
    for result in results:
        old = previous.get(result["id"], {})
        profile = result["profile"]
        connection.execute(
            "INSERT INTO partner_candidates "
            "(id,source,source_place_id,discovered_for_request_id,created_at,last_refreshed_at) VALUES(?,?,?,?,?,?)",
            (result["id"], result["source"], result["source_place_id"], request_id, old.get("created_at", now), now),
        )
        connection.execute(
            "INSERT INTO public_capacity_profiles "
            "(id,candidate_id,profile_json,fit_score,fit_label,confidence,verification_status,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (result["profile_id"], result["id"], json.dumps(profile, allow_nan=False),
             profile["fit_score"], profile["fit_label"], profile["confidence"],
             VERIFICATION_STATUS, old.get("profile_created_at", now)),
        )
