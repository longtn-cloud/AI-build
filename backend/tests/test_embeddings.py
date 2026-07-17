from unittest.mock import MagicMock

from app.services import embeddings


def test_embed_texts_calls_voyage_with_document_input_type(monkeypatch):
    fake_client = MagicMock()
    fake_client.embed.return_value = MagicMock(embeddings=[[0.1, 0.2], [0.3, 0.4]])
    monkeypatch.setattr(embeddings, "_client", fake_client)

    result = embeddings.embed_texts(["chunk one", "chunk two"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]
    fake_client.embed.assert_called_once_with(
        ["chunk one", "chunk two"], model="voyage-3-lite", input_type="document"
    )


def test_embed_query_calls_voyage_with_query_input_type(monkeypatch):
    fake_client = MagicMock()
    fake_client.embed.return_value = MagicMock(embeddings=[[0.5, 0.6]])
    monkeypatch.setattr(embeddings, "_client", fake_client)

    result = embeddings.embed_query("what is the refund policy?")

    assert result == [0.5, 0.6]
    fake_client.embed.assert_called_once_with(
        ["what is the refund policy?"], model="voyage-3-lite", input_type="query"
    )
