import uuid

import psycopg

from tests.conftest import TEST_DB_URL


def test_inserting_an_auth_user_auto_creates_a_profile():
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO auth.users (id, email) VALUES (%s, %s)", (user_id, "a@example.com")
        )
        row = conn.execute(
            "SELECT email FROM profiles WHERE id = %s", (user_id,)
        ).fetchone()

    assert row == ("a@example.com",)
