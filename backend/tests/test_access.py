import uuid

import psycopg
from psycopg.rows import dict_row

from tests.conftest import TEST_DB_URL


def _create_user() -> str:
    user_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
    return user_id


def _create_document(user_id: str) -> str:
    document_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, 'a.txt', 'txt', 'path/a.txt', 'ready')
            """,
            (document_id, user_id),
        )
    return document_id


def test_document_access_clause_allows_owner_and_team_shared_and_excludes_others():
    from app.services.access import DOCUMENT_ACCESS_CLAUSE, access_params

    owner_id = _create_user()
    member_id = _create_user()
    stranger_id = _create_user()
    team_id = str(uuid.uuid4())
    owned_doc = _create_document(owner_id)
    unshared_doc = _create_document(owner_id)

    with psycopg.connect(TEST_DB_URL, autocommit=True, row_factory=dict_row) as conn:
        conn.execute(
            "INSERT INTO teams (id, name, created_by) VALUES (%s, 'Team', %s)",
            (team_id, owner_id),
        )
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES (%s, %s, 'admin'), (%s, %s, 'member')",
            (team_id, owner_id, team_id, member_id),
        )
        conn.execute(
            "INSERT INTO document_shares (document_id, team_id, shared_by) VALUES (%s, %s, %s)",
            (owned_doc, team_id, owner_id),
        )

        def accessible_ids(user_id: str) -> set[str]:
            rows = conn.execute(
                f"SELECT d.id FROM documents d WHERE {DOCUMENT_ACCESS_CLAUSE}",
                access_params(user_id),
            ).fetchall()
            return {str(r["id"]) for r in rows}

        assert accessible_ids(owner_id) == {owned_doc, unshared_doc}
        assert accessible_ids(member_id) == {owned_doc}
        assert accessible_ids(stranger_id) == set()


def test_is_team_member():
    from app.services.access import is_team_member

    owner_id = _create_user()
    stranger_id = _create_user()
    team_id = str(uuid.uuid4())
    with psycopg.connect(TEST_DB_URL, autocommit=True, row_factory=dict_row) as conn:
        conn.execute(
            "INSERT INTO teams (id, name, created_by) VALUES (%s, 'Team', %s)",
            (team_id, owner_id),
        )
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES (%s, %s, 'admin')",
            (team_id, owner_id),
        )
        assert is_team_member(conn, team_id, owner_id) is True
        assert is_team_member(conn, team_id, stranger_id) is False
