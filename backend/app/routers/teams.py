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


@router.get("/{team_id}/members")
def list_members(team_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        _require_member(conn, team_id, user_id)
        rows = conn.execute(
            """
            SELECT tm.user_id, p.email, tm.role, tm.added_at
            FROM team_members tm
            JOIN profiles p ON p.id = tm.user_id
            WHERE tm.team_id = %s
            ORDER BY tm.added_at
            """,
            (team_id,),
        ).fetchall()
    return [
        {
            "user_id": str(row["user_id"]),
            "email": row["email"],
            "role": row["role"],
            "added_at": row["added_at"].isoformat(),
        }
        for row in rows
    ]


@router.get("/{team_id}/members/search")
def search_members(team_id: str, q: str = "", user_id: str = Depends(get_current_user_id)):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query must not be empty")
    with get_conn() as conn:
        _require_admin(conn, team_id, user_id)
        rows = conn.execute(
            """
            SELECT id, email
            FROM profiles
            WHERE email ILIKE %s
              AND id NOT IN (SELECT user_id FROM team_members WHERE team_id = %s)
            ORDER BY email
            LIMIT 20
            """,
            (f"%{q}%", team_id),
        ).fetchall()
    return [{"user_id": str(row["id"]), "email": row["email"]} for row in rows]


class AddMemberRequest(BaseModel):
    user_id: str


@router.post("/{team_id}/members", status_code=201)
def add_member(team_id: str, body: AddMemberRequest, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        _require_admin(conn, team_id, user_id)
        profile_row = conn.execute(
            "SELECT id, email FROM profiles WHERE id = %s", (body.user_id,)
        ).fetchone()
        if profile_row is None:
            raise HTTPException(status_code=404, detail="User not found")

        row = conn.execute(
            """
            INSERT INTO team_members (team_id, user_id, role)
            VALUES (%s, %s, 'member')
            ON CONFLICT (team_id, user_id) DO NOTHING
            RETURNING role, added_at
            """,
            (team_id, body.user_id),
        ).fetchone()
        if row is None:
            row = conn.execute(
                "SELECT role, added_at FROM team_members WHERE team_id = %s AND user_id = %s",
                (team_id, body.user_id),
            ).fetchone()

    return {
        "user_id": body.user_id,
        "email": profile_row["email"],
        "role": row["role"],
        "added_at": row["added_at"].isoformat(),
    }


@router.delete("/{team_id}/members/{member_user_id}", status_code=204)
def remove_member(team_id: str, member_user_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        _require_admin(conn, team_id, user_id)
        if member_user_id == user_id:
            raise HTTPException(status_code=403, detail="Cannot remove the team admin")
        conn.execute(
            "DELETE FROM team_members WHERE team_id = %s AND user_id = %s",
            (team_id, member_user_id),
        )
