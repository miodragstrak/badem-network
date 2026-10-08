"""Deterministic production commitments and confirmed Devnet Memo transactions."""

import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import time

import httpx
from solders.hash import Hash, ParseHashError
from solders.instruction import AccountMeta, Instruction
from solders.keypair import Keypair
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import SanitizeError, Transaction, TransactionError

from backend.proofs import ProductionProof, canonical_message


MEMO_PROGRAM_ID = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
ANCHOR_PREFIX = b"BADEM_PROOF_ANCHOR_V1|"
MEMO_PREFIX = "BADEM:proof:v1:sha256:"


def canonical_anchor_payload(proof: ProductionProof) -> bytes:
    return ANCHOR_PREFIX + canonical_message(proof) + (
        f"|{proof.public_key.lower()}|{proof.signature.lower()}"
    ).encode("utf-8")


def anchor_hash(proof: ProductionProof) -> str:
    return hashlib.sha256(canonical_anchor_payload(proof)).hexdigest()


def explorer_url(signature: str, cluster: str = "devnet") -> str:
    if cluster != "devnet":
        raise ValueError("Only Solana Devnet is supported")
    Signature.from_string(signature)
    return f"https://explorer.solana.com/tx/{signature}?cluster=devnet"


class AnchorConfigurationError(Exception):
    pass


class AnchorRPCError(Exception):
    pass


class AnchorPendingError(Exception):
    pass


class AnchorFailedError(Exception):
    pass


@dataclass(frozen=True)
class PreparedAnchor:
    transaction_signature: str
    signed_transaction: str
    last_valid_block_height: int


class SolanaAnchorService:
    def __init__(self, rpc_url: str, payer: Keypair, cluster: str = "devnet", *,
                 transport=None, confirmation_attempts: int = 30, poll_interval: float = 1):
        if cluster != "devnet":
            raise AnchorConfigurationError("SOLANA_CLUSTER must be devnet")
        try:
            url = httpx.URL(rpc_url)
        except httpx.InvalidURL:
            raise AnchorConfigurationError("SOLANA_RPC_URL is invalid") from None
        if url.scheme != "https" or not url.host:
            raise AnchorConfigurationError("SOLANA_RPC_URL must be an HTTPS Devnet endpoint")
        self.rpc_url = rpc_url
        self.payer = payer
        self.cluster = cluster
        self.transport = transport
        self.confirmation_attempts = confirmation_attempts
        self.poll_interval = poll_interval

    @classmethod
    def from_environment(cls):
        rpc_url = os.getenv("SOLANA_RPC_URL", "")
        private_key = os.getenv("SOLANA_PAYER_PRIVATE_KEY", "")
        keypair_path = os.getenv("SOLANA_PAYER_KEYPAIR_PATH", "")
        if not rpc_url or not (private_key or keypair_path):
            raise AnchorConfigurationError(
                "Set SOLANA_RPC_URL and either SOLANA_PAYER_KEYPAIR_PATH or SOLANA_PAYER_PRIVATE_KEY"
            )
        if private_key and keypair_path:
            raise AnchorConfigurationError("Set only one of SOLANA_PAYER_KEYPAIR_PATH and SOLANA_PAYER_PRIVATE_KEY")
        try:
            if keypair_path:
                private_key = Path(keypair_path).expanduser().read_text(encoding="utf-8")
            if keypair_path or private_key.lstrip().startswith("["):
                values = json.loads(private_key)
                if not isinstance(values, list) or len(values) != 64 or any(
                    type(value) is not int or not 0 <= value <= 255 for value in values
                ):
                    raise ValueError
                payer = Keypair.from_bytes(bytes(values))
            else:
                payer = Keypair.from_base58_string(private_key)
        except (OSError, UnicodeError, ValueError, TypeError):
            if keypair_path:
                raise AnchorConfigurationError(
                    "SOLANA_PAYER_KEYPAIR_PATH must point to a readable JSON 64-byte Solana keypair"
                ) from None
            raise AnchorConfigurationError(
                "SOLANA_PAYER_PRIVATE_KEY must be a Base58 or JSON 64-byte Solana keypair"
            ) from None
        return cls(rpc_url, payer, os.getenv("SOLANA_CLUSTER", "devnet"))

    def _rpc(self, client, method, params=None):
        try:
            response = client.post(self.rpc_url, json={
                "jsonrpc": "2.0", "id": 1, "method": method, "params": params or [],
            })
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError):
            raise AnchorRPCError(f"Solana {method} request failed") from None
        if not isinstance(body, dict) or body.get("id") != 1 or body.get("error") or "result" not in body:
            raise AnchorRPCError(f"Solana {method} returned an invalid/error response")
        return body["result"]

    def _require_devnet(self, client):
        if self._rpc(client, "getGenesisHash") != DEVNET_GENESIS_HASH:
            raise AnchorRPCError("RPC is not the supported Solana Devnet cluster; refusing submission")

    def prepare(self, digest: str) -> PreparedAnchor:
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ValueError("Expected a lowercase SHA-256 anchor hash")
        with httpx.Client(transport=self.transport, timeout=10, trust_env=False) as client:
            self._require_devnet(client)
            result = self._rpc(client, "getLatestBlockhash", [{"commitment": "confirmed"}])
        try:
            value = result["value"]
            blockhash = Hash.from_string(value["blockhash"])
            height = value["lastValidBlockHeight"]
            if type(height) is not int or height < 0:
                raise ValueError
        except (KeyError, TypeError, ValueError, ParseHashError):
            raise AnchorRPCError("Solana returned an invalid latest blockhash") from None
        instruction = Instruction(MEMO_PROGRAM_ID, (MEMO_PREFIX + digest).encode("utf-8"), [
            AccountMeta(self.payer.pubkey(), is_signer=True, is_writable=False),
        ])
        message = Message.new_with_blockhash([instruction], self.payer.pubkey(), blockhash)
        transaction = Transaction([self.payer], message, blockhash)
        transaction.verify()
        return PreparedAnchor(str(transaction.signatures[0]),
            base64.b64encode(bytes(transaction)).decode("ascii"), height)

    def _status(self, client, signature):
        result = self._rpc(client, "getSignatureStatuses", [
            [signature], {"searchTransactionHistory": True},
        ])
        if not isinstance(result, dict) or not isinstance(result.get("value"), list) or len(result["value"]) != 1:
            raise AnchorRPCError("Solana returned invalid signature statuses")
        status = result["value"][0]
        if status is not None:
            if not isinstance(status, dict) or "err" not in status:
                raise AnchorRPCError("Solana returned an invalid signature status")
            if status["err"] is not None:
                raise AnchorFailedError("Solana transaction execution failed; no replacement transaction created")
            if status.get("confirmationStatus") not in {"processed", "confirmed", "finalized"}:
                raise AnchorRPCError("Solana returned an invalid confirmation status")
        return status

    def submit_and_confirm(self, prepared: PreparedAnchor, digest: str):
        try:
            transaction = Transaction.from_bytes(base64.b64decode(prepared.signed_transaction, validate=True))
            transaction.verify()
            instructions = transaction.message.instructions
            if len(transaction.signatures) != 1 or str(transaction.signatures[0]) != prepared.transaction_signature:
                raise ValueError
            if len(instructions) != 1 or len(transaction.message.account_keys) != 2:
                raise ValueError
            instruction = instructions[0]
            if (transaction.message.account_keys[instruction.program_id_index] != MEMO_PROGRAM_ID or
                    bytes(instruction.data) != (MEMO_PREFIX + digest).encode("utf-8") or
                    bytes(instruction.accounts) != b"\0"):
                raise ValueError
        except (ValueError, IndexError, TransactionError, SanitizeError):
            raise AnchorRPCError("Persisted transaction is not the signed Memo for this proof") from None
        # Reuse the persisted transaction after every uncertain outcome, never re-sign it.
        with httpx.Client(transport=self.transport, timeout=10, trust_env=False) as client:
            self._require_devnet(client)
            status = self._status(client, prepared.transaction_signature)
            if status and status["confirmationStatus"] == "finalized":
                return
            if status is None:
                height = self._rpc(client, "getBlockHeight", [{"commitment": "finalized"}])
                if type(height) is not int or height < 0:
                    raise AnchorRPCError("Solana returned an invalid block height")
                if height > prepared.last_valid_block_height:
                    status = self._status(client, prepared.transaction_signature)
                    if status and status["confirmationStatus"] == "finalized":
                        return
                    if status is None:
                        raise AnchorFailedError(
                            "Unconfirmed transaction expired; operator reconciliation required, no replacement created"
                        )
                if status is None:
                    signature = self._rpc(client, "sendTransaction", [prepared.signed_transaction, {
                        "encoding": "base64", "skipPreflight": False,
                        "preflightCommitment": "confirmed", "maxRetries": 3,
                    }])
                    if signature != prepared.transaction_signature:
                        raise AnchorRPCError("RPC transaction signature does not match the signed transaction")
            for attempt in range(self.confirmation_attempts):
                status = self._status(client, prepared.transaction_signature)
                if status and status["confirmationStatus"] == "finalized":
                    return
                if attempt + 1 < self.confirmation_attempts:
                    time.sleep(self.poll_interval)
        raise AnchorPendingError("Transaction not finalized yet; retry this proof's anchor request to reconcile")
