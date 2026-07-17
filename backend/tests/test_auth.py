import uuid

import pytest
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
