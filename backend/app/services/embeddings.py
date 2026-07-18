from google import genai
from google.genai import types

from app.config import settings

MODEL = "gemini-embedding-001"
OUTPUT_DIMENSIONALITY = 384

_client = genai.Client(api_key=settings.gemini_api_key)


def embed_texts(texts: list[str]) -> list[list[float]]:
    response = _client.models.embed_content(
        model=MODEL,
        contents=texts,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=OUTPUT_DIMENSIONALITY,
        ),
    )
    return [embedding.values for embedding in response.embeddings]


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
