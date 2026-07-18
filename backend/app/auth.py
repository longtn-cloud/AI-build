import jwt
from fastapi import Header, HTTPException

from app.config import settings

# Supabase projects using the newer JWT Signing Keys feature sign access
# tokens with an asymmetric key (ES256/RS256) rather than the legacy shared
# HS256 secret. The HS256 attempt below covers projects (and this test
# suite's tokens) still using the shared secret; anything that fails it
# falls back to fetching the project's public signing key from its JWKS
# endpoint. PyJWKClient caches fetched keys, so this doesn't hit the network
# on every request.
_jwks_client = jwt.PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")


def get_current_user_id(authorization: str = Header(default="")) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ")

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload["sub"]
    except jwt.PyJWTError:
        pass

    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
        return payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
