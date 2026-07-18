from unittest.mock import MagicMock

from app.services import embeddings


def test_embed_texts_encodes_with_model(monkeypatch):
    fake_model = MagicMock()
    fake_model.encode.return_value = MagicMock(tolist=lambda: [[0.1, 0.2], [0.3, 0.4]])
    monkeypatch.setattr(embeddings, "_model", fake_model)

    result = embeddings.embed_texts(["chunk one", "chunk two"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]
    fake_model.encode.assert_called_once_with(["chunk one", "chunk two"])


def test_embed_query_encodes_single_text(monkeypatch):
    fake_model = MagicMock()
    fake_model.encode.return_value = MagicMock(tolist=lambda: [[0.5, 0.6]])
    monkeypatch.setattr(embeddings, "_model", fake_model)

    result = embeddings.embed_query("what is the refund policy?")

    assert result == [0.5, 0.6]
    fake_model.encode.assert_called_once_with(["what is the refund policy?"])
