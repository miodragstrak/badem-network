"""Ask the running BADEM API to anchor one existing verified proof on Devnet."""

import argparse
import os
from pathlib import Path
import sys
from urllib.parse import quote

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "api"))
from backend.solana_anchor import explorer_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proof_id", help="Existing proof_id returned by POST /api/proofs")
    args = parser.parse_args()
    admin = os.getenv("BADEM_ADMIN_KEY", "")
    if not admin:
        parser.error("Set BADEM_ADMIN_KEY for the running backend")
    endpoint = os.getenv("BADEM_API_URL", "http://127.0.0.1:8000").rstrip("/")
    try:
        with httpx.Client(timeout=180, follow_redirects=False) as client:
            response = client.post(f"{endpoint}/api/proofs/{quote(args.proof_id, safe='')}/anchor",
                headers={"X-Admin-Key": admin})
    except (httpx.HTTPError, httpx.InvalidURL):
        parser.exit(1, "Backend request failed. The proof may be pending; reconcile using the same proof ID.\n")
    if response.status_code != 200:
        parser.exit(1, f"Anchor request returned HTTP {response.status_code}; no finalized success reported.\n")
    try:
        result = response.json()
        if (result["status"] != "ANCHORED" or result["cluster"] != "devnet" or
                result["confirmation"] != "finalized" or result["proof_id"] != args.proof_id):
            raise ValueError
        signature = result["transaction_signature"]
        url = explorer_url(signature, result["cluster"])
    except (ValueError, TypeError, KeyError):
        parser.exit(1, "Backend did not return a valid finalized Devnet receipt.\n")
    print(f"Transaction signature: {signature}")
    print(f"Solana Explorer: {url}")


if __name__ == "__main__":
    main()
