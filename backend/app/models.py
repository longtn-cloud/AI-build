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
