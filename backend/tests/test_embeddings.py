from unittest.mock import MagicMock

from app.services import embeddings


def _fake_response(vectors):
    return MagicMock(embeddings=[MagicMock(values=v) for v in vectors])


def test_embed_texts_calls_embed_content_for_documents(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.embed_content.return_value = _fake_response([[0.1, 0.2], [0.3, 0.4]])
    monkeypatch.setattr(embeddings, "_client", fake_client)

    result = embeddings.embed_texts(["chunk one", "chunk two"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]
    _, kwargs = fake_client.models.embed_content.call_args
    assert kwargs["model"] == embeddings.MODEL
    assert kwargs["contents"] == ["chunk one", "chunk two"]
    assert kwargs["config"].task_type == "RETRIEVAL_DOCUMENT"
    assert kwargs["config"].output_dimensionality == embeddings.OUTPUT_DIMENSIONALITY


def test_embed_query_calls_embed_content_for_query(monkeypatch):
    fake_client = MagicMock()
    fake_client.models.embed_content.return_value = _fake_response([[0.5, 0.6]])
    monkeypatch.setattr(embeddings, "_client", fake_client)

    result = embeddings.embed_query("what is the refund policy?")

    assert result == [0.5, 0.6]
    _, kwargs = fake_client.models.embed_content.call_args
    assert kwargs["contents"] == ["what is the refund policy?"]
    assert kwargs["config"].task_type == "RETRIEVAL_QUERY"
    assert kwargs["config"].output_dimensionality == embeddings.OUTPUT_DIMENSIONALITY
