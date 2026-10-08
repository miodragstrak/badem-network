"""Proof of Production v0.1 payload and canonical Ed25519 message."""

import re
from typing import Literal

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field


IDENTIFIER_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"
PUBLIC_KEY_PATTERN = r"^[0-9a-fA-F]{64}$"


class ProductionProof(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1, max_length=80, pattern=IDENTIFIER_PATTERN)
    job_id: str = Field(min_length=1, max_length=100, pattern=IDENTIFIER_PATTERN)
    event: Literal["COMPLETED"]
    timestamp: int = Field(strict=True, ge=0, le=2**63 - 1)
    proof_hash: str = Field(
        pattern=r"^(?:[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,44})$"
    )
    public_key: str = Field(pattern=PUBLIC_KEY_PATTERN)
    signature: str = Field(pattern=r"^[0-9a-fA-F]{128}$")


def canonical_message(proof: ProductionProof) -> bytes:
    return (
        f"{proof.node_id}|{proof.job_id}|{proof.event}|"
        f"{proof.timestamp}|{proof.proof_hash}"
    ).encode("utf-8")


def registered_public_key(value: str) -> Ed25519PublicKey:
    if not re.fullmatch(PUBLIC_KEY_PATTERN, value):
        raise ValueError("Public key must be 64 hex characters")
    return Ed25519PublicKey.from_public_bytes(bytes.fromhex(value))
