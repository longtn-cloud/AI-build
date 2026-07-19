DOCUMENT_ACCESS_CLAUSE = """(
    d.user_id = %s
    OR d.id IN (
        SELECT ds.document_id
        FROM document_shares ds
        JOIN team_members tm ON tm.team_id = ds.team_id
        WHERE tm.user_id = %s
    )
)"""

QUIZ_ACCESS_CLAUSE = """(
    q.user_id = %s
    OR q.id IN (
        SELECT qs.quiz_id
        FROM quiz_shares qs
        JOIN team_members tm ON tm.team_id = qs.team_id
        WHERE tm.user_id = %s
    )
)"""


def access_params(user_id: str) -> tuple[str, str]:
    return (user_id, user_id)


def is_team_member(conn, team_id: str, user_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM team_members WHERE team_id = %s AND user_id = %s",
        (team_id, user_id),
    ).fetchone()
    return row is not None
