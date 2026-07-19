from google import genai
from google.genai import types

from app.config import settings

MODEL = "gemini-embedding-001"
OUTPUT_DIMENSIONALITY = 384
_BATCH_SIZE = 100

_client = genai.Client(api_key=settings.gemini_api_key)


def embed_texts(texts: list[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        batch = texts[start : start + _BATCH_SIZE]
        response = _client.models.embed_content(
            model=MODEL,
            contents=batch,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT",
                output_dimensionality=OUTPUT_DIMENSIONALITY,
            ),
        )
        vectors.extend(embedding.values for embedding in response.embeddings)
    return vectors


def embed_query(text: str) -> list[float]:
    response = _client.models.embed_content(
        model=MODEL,
        contents=[text],
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=OUTPUT_DIMENSIONALITY,
        ),
    )
    return response.embeddings[0].values
