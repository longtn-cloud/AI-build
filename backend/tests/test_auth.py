import logging
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.auth import get_current_user_id
from app.config import settings
from tests.helpers import make_token

test_app = FastAPI()


@test_app.get("/whoami")
def whoami(user_id: str = Depends(get_current_user_id)):
    return {"user_id": user_id}


client = TestClient(test_app)


def test_valid_token_returns_user_id():
    user_id = str(uuid.uuid4())
    token = make_token(user_id, settings.supabase_jwt_secret)

    response = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": user_id}


def test_missing_header_returns_401():
    response = client.get("/whoami")
    assert response.status_code == 401


def test_invalid_token_returns_401():
    response = client.get("/whoami", headers={"Authorization": "Bearer garbage"})
    assert response.status_code == 401


def test_invalid_token_logs_both_verification_failure_reasons(caplog):
    with caplog.at_level(logging.WARNING):
        response = client.get("/whoami", headers={"Authorization": "Bearer garbage"})

    assert response.status_code == 401
    assert "HS256" in caplog.text
    assert "JWKS" in caplog.text


def test_token_missing_sub_claim_returns_401_not_500():
    payload = {"aud": "authenticated", "exp": int(time.time()) + 3600}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")

    response = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_es256_token_verified_via_jwks_returns_user_id(monkeypatch):
    # Supabase projects created with the newer JWT Signing Keys feature sign
    # access tokens with an asymmetric key (ES256), not the legacy shared
    # HS256 secret. This reproduces that: a token signed with a local EC key,
    # verified via the JWKS-lookup fallback (mocked here, no network call).
    from app import auth as auth_module

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    user_id = str(uuid.uuid4())
    payload = {"sub": user_id, "aud": "authenticated", "exp": int(time.time()) + 3600}
    token = jwt.encode(payload, private_key, algorithm="ES256")

    class FakeSigningKey:
        key = public_key

    monkeypatch.setattr(
        auth_module._jwks_client, "get_signing_key_from_jwt", lambda _token: FakeSigningKey()
    )

    response = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"user_id": user_id}
