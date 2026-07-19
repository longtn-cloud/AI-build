import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.config import settings
from app.db import get_conn
from app.models import DocumentListItemOut, DocumentOut
from app.services.processing import process_document
from app.services.storage import create_signed_url, delete_file, upload_file

router = APIRouter(prefix="/documents", tags=["documents"])


@router.post("", response_model=DocumentOut, status_code=201)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    file_type = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if file_type not in settings.allowed_file_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_type}")

    file_bytes = file.file.read()
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


@router.get("", response_model=list[DocumentListItemOut])
def list_documents(user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, filename, file_type, status,
                   error_reason, uploaded_at
            FROM documents
            WHERE user_id = %s
            ORDER BY uploaded_at DESC
            """,
            (user_id,),
        ).fetchall()
    return rows


class RenameRequest(BaseModel):
    filename: str


@router.patch("/{document_id}", response_model=DocumentOut)
def rename_document(
    document_id: str,
    body: RenameRequest,
    user_id: str = Depends(get_current_user_id),
):
    with get_conn() as conn:
        row = conn.execute(
            """
            UPDATE documents SET filename = %s
            WHERE id = %s AND user_id = %s
            RETURNING id, user_id, filename, file_type, storage_path, status,
                      error_reason, extracted_text, uploaded_at
            """,
            (body.filename, document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return row


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")

    delete_file(row["storage_path"])

    with get_conn() as conn:
        conn.execute(
            "DELETE FROM documents WHERE id = %s AND user_id = %s", (document_id, user_id)
        )


@router.get("/{document_id}/download")
def get_download_url(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT storage_path FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"url": create_signed_url(row["storage_path"])}


@router.get("/{document_id}/preview")
def get_preview(document_id: str, user_id: str = Depends(get_current_user_id)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT file_type, status, extracted_text FROM documents WHERE id = %s AND user_id = %s",
            (document_id, user_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if row["file_type"] != "docx":
        raise HTTPException(
            status_code=400,
            detail="Preview endpoint only applies to docx files; use the download URL for other types",
        )
    if row["status"] != "ready":
        raise HTTPException(status_code=409, detail="Document is not ready yet")
    return {"text": row["extracted_text"]}
