import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.db import get_conn

router = APIRouter(prefix="/teams", tags=["teams"])


class CreateTeamRequest(BaseModel):
    name: str


def _serialize_team(row) -> dict:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "role": row["role"],
        "created_at": row["created_at"].isoformat(),
    }


@router.post("", status_code=201)
def create_team(body: CreateTeamRequest, user_id: str = Depends(get_current_user_id)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Team name must not be empty")

    team_id = str(uuid.uuid4())
    with get_conn() as conn:
        team_row = conn.execute(
            """
            INSERT INTO teams (id, name, created_by)
            VALUES (%s, %s, %s)
            RETURNING id, name, created_at
            """,
            (team_id, body.name, user_id),
        ).fetchone()
        conn.execute(
            "INSERT INTO team_members (team_id, user_id, role) VALUES (%s, %s, 'admin')",
            (team_id, user_id),
        )

    return _serialize_team({**team_row, "role": "admin"})


@router.get("")
def list_teams(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT t.id, t.name, t.created_at, tm.role
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.user_id = %s
            ORDER BY t.created_at
            """,
            (user_id,),
        ).fetchall()
    return [_serialize_team(row) for row in rows]


def _require_member(conn, team_id: str, user_id: str) -> str:
    row = conn.execute(
        "SELECT role FROM team_members WHERE team_id = %s AND user_id = %s",
        (team_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return row["role"]


def _require_admin(conn, team_id: str, user_id: str) -> None:
    if _require_member(conn, team_id, user_id) != "admin":
        raise HTTPException(status_code=403, detail="Only the team admin can do this")
