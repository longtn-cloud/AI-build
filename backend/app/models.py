from datetime import datetime

from pydantic import BaseModel


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
