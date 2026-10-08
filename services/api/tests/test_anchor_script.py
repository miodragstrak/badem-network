from pathlib import Path
import runpy
import sys

import httpx
import pytest
from solders.keypair import Keypair


@pytest.fixture
def manual_script(monkeypatch):
    script = Path(__file__).resolve().parents[3] / "solana" / "scripts" / "anchor_proof.py"
    main = runpy.run_path(str(script))["main"]
    monkeypatch.setenv("BADEM_ADMIN_KEY", "test-admin")
    monkeypatch.setenv("BADEM_API_URL", "https://backend.invalid")
    monkeypatch.setattr(sys, "argv", [str(script), "existing-proof-id"])
    signature = str(Keypair().sign_message(b"mocked script receipt only"))
    result = {"status": "ANCHORED", "cluster": "devnet", "confirmation": "finalized",
        "proof_id": "existing-proof-id", "transaction_signature": signature}
    return main, result


def mock_backend(monkeypatch, result, status_code=200):
    client_type = httpx.Client

    def handle(request):
        assert str(request.url) == "https://backend.invalid/api/proofs/existing-proof-id/anchor"
        assert request.headers["X-Admin-Key"] == "test-admin"
        return httpx.Response(status_code, json=result)

    monkeypatch.setattr(httpx, "Client", lambda **kwargs:
        client_type(transport=httpx.MockTransport(handle), **kwargs))


def test_script_prints_only_finalized_signature_and_devnet_url(manual_script, monkeypatch, capsys):
    main, result = manual_script
    mock_backend(monkeypatch, result)
    main()
    output = capsys.readouterr().out
    signature = result["transaction_signature"]
    assert output == f"Transaction signature: {signature}\nSolana Explorer: https://explorer.solana.com/tx/{signature}?cluster=devnet\n"
    assert "test-admin" not in output


@pytest.mark.parametrize("changes", [
    {"status": "PENDING"}, {"confirmation": "confirmed"}, {"cluster": "mainnet-beta"},
    {"transaction_signature": "not-a-signature"}, {"proof_id": "wrong-proof"},
])
def test_script_never_prints_unconfirmed_or_invalid_receipt(manual_script, monkeypatch, capsys, changes):
    main, result = manual_script
    mock_backend(monkeypatch, {**result, **changes})
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
    assert capsys.readouterr().out == ""


def test_script_rejects_backend_failure(manual_script, monkeypatch, capsys):
    main, _ = manual_script
    mock_backend(monkeypatch, {}, status_code=503)
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "HTTP 503" in captured.err


def test_script_requires_admin_environment(manual_script, monkeypatch, capsys):
    main, _ = manual_script
    monkeypatch.delenv("BADEM_ADMIN_KEY")
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert capsys.readouterr().out == ""
