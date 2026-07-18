from sentence_transformers import SentenceTransformer

MODEL = "all-MiniLM-L6-v2"

_model = SentenceTransformer(MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    return _model.encode(texts).tolist()


def embed_query(text: str) -> list[float]:
    return _model.encode([text]).tolist()[0]
