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


def test_embed_texts_batches_large_input_across_multiple_calls(monkeypatch):
    fake_client = MagicMock()

    def fake_embed_content(model, contents, config):
        return _fake_response([[float(i)] for i in range(len(contents))])

    fake_client.models.embed_content.side_effect = fake_embed_content
    monkeypatch.setattr(embeddings, "_client", fake_client)

    texts = [f"chunk {i}" for i in range(250)]
    result = embeddings.embed_texts(texts)

    assert len(result) == 250
    assert fake_client.models.embed_content.call_count == 3
    call_sizes = [
        len(call.kwargs["contents"]) for call in fake_client.models.embed_content.call_args_list
    ]
    assert call_sizes == [100, 100, 50]
