import anthropic

from app.config import settings

_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

MODEL = "claude-sonnet-5"

SYSTEM_PROMPT = (
    "You are a document assistant. Answer the user's question using ONLY the "
    "document passages provided below. Mention the source filename when you "
    "draw on a passage. If the passages do not contain enough information to "
    "answer the question, say so directly instead of answering from general "
    "knowledge."
)


def answer_from_chunks(question: str, chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[Source: {c['filename']}, passage {c['chunk_index'] + 1} of {c['total_chunks']}]\n{c['content']}"
        for c in chunks
    )
    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        thinking={"type": "disabled"},
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Document passages:\n\n{context}\n\nQuestion: {question}",
            }
        ],
    )
    return "".join(block.text for block in message.content if block.type == "text")


def answer_with_web_search(question: str) -> str:
    message = _client.messages.create(
        model=MODEL,
        max_tokens=2048,
        tools=[{"type": "web_search_20260209", "name": "web_search"}],
        messages=[{"role": "user", "content": question}],
    )
    return "".join(block.text for block in message.content if block.type == "text")
