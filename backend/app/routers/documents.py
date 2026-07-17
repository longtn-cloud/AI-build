import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile

from app.auth import get_current_user_id
from app.config import settings
from app.db import get_conn
from app.models import DocumentOut
from app.services.storage import upload_file

router = APIRouter(prefix="/documents", tags=["documents"])


def process_document(document_id: str) -> None:  # placeholder, replaced in Task 10
    pass


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    file_type = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if file_type not in settings.allowed_file_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")

    file_bytes = await file.read()
    if len(file_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=400, detail="File exceeds maximum size")

    document_id = str(uuid.uuid4())
    storage_path = f"{user_id}/{document_id}.{file_type}"
    upload_file(storage_path, file_bytes, file.content_type or "application/octet-stream")

    with get_conn() as conn:
        row = conn.execute(
            """
            INSERT INTO documents (id, user_id, filename, file_type, storage_path, status)
            VALUES (%s, %s, %s, %s, %s, 'uploading')
            RETURNING id, user_id, filename, file_type, storage_path, status,
                      error_reason, extracted_text, uploaded_at
            """,
            (document_id, user_id, file.filename, file_type, storage_path),
        ).fetchone()

    background_tasks.add_task(process_document, document_id)
    return row
