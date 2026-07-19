from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator


class DocumentOut(BaseModel):
    id: str
    user_id: str
    filename: str
    file_type: str
    storage_path: str
    status: str
    error_reason: str | None = None
    extracted_text: str | None = None
    uploaded_at: datetime

    @field_validator("id", "user_id", mode="before")
    @classmethod
    def _stringify_uuid(cls, value):
        if isinstance(value, UUID):
            return str(value)
        return value


class DocumentListItemOut(BaseModel):
    id: str
    user_id: str
    filename: str
    file_type: str
    status: str
    error_reason: str | None = None
    uploaded_at: datetime
    shared_team_ids: list[str] = []

    @field_validator("id", "user_id", mode="before")
    @classmethod
    def _stringify_uuid(cls, value):
        if isinstance(value, UUID):
            return str(value)
        return value

    @field_validator("shared_team_ids", mode="before")
    @classmethod
    def _stringify_team_ids(cls, value):
        if value is None:
            return []
        return [str(v) for v in value]
