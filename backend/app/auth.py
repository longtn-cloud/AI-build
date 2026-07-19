import logging

import jwt
from fastapi import Header, HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

# Supabase projects using the newer JWT Signing Keys feature sign access
# tokens with an asymmetric key (ES256/RS256) rather than the legacy shared
# HS256 secret. The HS256 attempt below covers projects (and this test
# suite's tokens) still using the shared secret; anything that fails it
# falls back to fetching the project's public signing key from its JWKS
# endpoint. PyJWKClient caches fetched keys, so this doesn't hit the network
# on every request.
_jwks_client = jwt.PyJWKClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")

# PyJWT validates "iat"/"exp" against this server's clock with zero leeway by
# default. A few seconds of drift between this host's clock and Supabase's
# (common on VMs/containers) makes PyJWT reject an already-valid token with
# ImmatureSignatureError. Tolerate small skew instead of trusting perfect
# clock sync.
_CLOCK_SKEW_LEEWAY_SECONDS = 10


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
            leeway=_CLOCK_SKEW_LEEWAY_SECONDS,
        )
        sub = payload.get("sub")
        if sub is not None:
            return sub
        logger.warning("JWT verified via legacy HS256 secret but missing 'sub' claim")
    except jwt.PyJWTError as hs256_error:
        # Expected to fail (and log) for every real Supabase-issued token if
        # the project doesn't sign with the legacy shared secret - only a
        # problem if the JWKS fallback below also fails.
        logger.warning("JWT verification via legacy HS256 secret failed: %r", hs256_error)

    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            leeway=_CLOCK_SKEW_LEEWAY_SECONDS,
        )
        sub = payload.get("sub")
        if sub is not None:
            return sub
        logger.warning("JWT verified via JWKS but missing 'sub' claim")
    except jwt.PyJWTError as jwks_error:
        logger.warning("JWT verification via JWKS fallback failed: %r", jwks_error)

    raise HTTPException(status_code=401, detail="Invalid token")
