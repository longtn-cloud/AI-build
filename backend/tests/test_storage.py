from unittest.mock import MagicMock

from app.services import storage


def test_upload_file_calls_supabase_storage(monkeypatch):
    fake_bucket = MagicMock()
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    storage.upload_file("user1/doc1.pdf", b"file bytes", "application/pdf")

    fake_client.storage.from_.assert_called_once_with(storage.settings.storage_bucket)
    fake_bucket.upload.assert_called_once_with(
        "user1/doc1.pdf", b"file bytes", {"content-type": "application/pdf"}
    )


def test_download_file_returns_bytes(monkeypatch):
    fake_bucket = MagicMock()
    fake_bucket.download.return_value = b"file bytes"
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    result = storage.download_file("user1/doc1.pdf")

    assert result == b"file bytes"


def test_delete_file_calls_remove(monkeypatch):
    fake_bucket = MagicMock()
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    storage.delete_file("user1/doc1.pdf")

    fake_bucket.remove.assert_called_once_with(["user1/doc1.pdf"])


def test_create_signed_url_returns_url(monkeypatch):
    fake_bucket = MagicMock()
    fake_bucket.create_signed_url.return_value = {"signedURL": "https://example.com/signed"}
    fake_client = MagicMock()
    fake_client.storage.from_.return_value = fake_bucket
    monkeypatch.setattr(storage, "_client", fake_client)

    result = storage.create_signed_url("user1/doc1.pdf")

    assert result == "https://example.com/signed"
    fake_bucket.create_signed_url.assert_called_once_with("user1/doc1.pdf", 3600)
