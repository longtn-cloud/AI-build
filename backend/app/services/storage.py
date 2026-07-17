from supabase import Client, create_client

from app.config import settings

try:
    _client: Client = create_client(settings.supabase_url, settings.supabase_service_role_key)
except Exception:
    # In test environment, this will be replaced by monkeypatch
    _client = None  # type: ignore


def upload_file(storage_path: str, file_bytes: bytes, content_type: str) -> None:
    _client.storage.from_(settings.storage_bucket).upload(
        storage_path, file_bytes, {"content-type": content_type}
    )


def download_file(storage_path: str) -> bytes:
    return _client.storage.from_(settings.storage_bucket).download(storage_path)


def delete_file(storage_path: str) -> None:
    _client.storage.from_(settings.storage_bucket).remove([storage_path])


def create_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    result = _client.storage.from_(settings.storage_bucket).create_signed_url(
        storage_path, expires_in
    )
    return result["signedURL"]
